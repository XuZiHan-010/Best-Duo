import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  ClientEvents,
  ServerEvents,
  type Challenge,
  type AccountProfilePayload,
  type GameRoom,
  type ProgressState,
  type SeatId
} from "@take-time/shared";
import { config } from "../config.js";
import { createScriptedAgent } from "../agent/scriptedAgent.js";
import type { InMemoryAgentRegistry } from "../agent/registry.js";
import { applyHintDecision, applyPlacement } from "../game/actions.js";
import { appendChatMessage } from "../game/chat.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { continueTurnOrHandoff } from "../game/handoff.js";
import { closeLevelRun, resetSessionIdentity } from "../game/identity.js";
import { beginPlacement, enterDiscussion, enterLevelSelect } from "../game/phases.js";
import {
  canStartGame,
  humanSeats,
  occupiedSeats,
  findSeat,
  isHost,
  resetRoundState,
  softResetRoom,
  totalPlacedCards
} from "../game/room.js";
import { enterResultAfterReveal, failByPlayerLeft, failByTimeout, revealAndScore } from "../game/reveal.js";
import { attachSeat, findEmptySeat, releaseSeat, transferHostToConnectedSeat } from "../game/seating.js";
import { PlayerSessionStore } from "../auth/playerSessions.js";
import { AccountSessionStore } from "../auth/accountSessions.js";
import { FailureRateLimiter, isAdminConfigured, verifyAdminCredentials } from "../auth/adminAuth.js";
import { AccountRateLimiter, ActionRateLimiter } from "../auth/accountRateLimit.js";
import {
  normalizeEmail,
  normalizeNickname,
  type AccountAdminAuditEntry,
  type AccountProfile,
  type AccountStore
} from "../auth/accountStore.js";
import {
  clearAllTimers,
  clearHostStartTimer,
  clearLevelSelectTimer,
  clearTurnTimers,
  startHostStartTimer,
  startLevelSelectTimer,
  clearDiscussionTimer,
  startDiscussionTimer,
  startHintTimer,
  startTurnTimer
} from "../game/timers.js";
import type { ProgressStore } from "../persistence/progressStore.js";
import { emitRoomError, emitStateToAll, emitStateToSocket } from "./emit.js";
import {
  adminKickPlayerSchema,
  adminAccountsForceLogoutSchema,
  adminAccountsListSchema,
  adminAccountsSetStatusSchema,
  adminAccountsSoftDeleteSchema,
  adminLoginSchema,
  adminEnterRoomSchema,
  adminSeizeRoomSchema,
  cardPlaceSchema,
  accountEmailChangeSchema,
  accountLoginSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
  accountRegisterSchema,
  accountSessionsRevokeOthersSchema,
  chatSendSchema,
  hintDecideSchema,
  hostSelectLevelSchema,
  hostRemoveAgentSchema,
  playerJoinSchema,
  settingsUpdateSchema
} from "../validation/schemas.js";

interface HandlerContext {
  io: Server;
  socket: Socket;
  room: GameRoom;
  levels: Challenge[];
  progressStore: ProgressStore;
  agentRegistry: InMemoryAgentRegistry;
  agentRuntime?: AgentRuntime;
  // 玩家账号仓库（ADR-0006）；未注入时退回"无账号"模式（仅测试基建使用）。
  accountStore?: AccountStore;
}

const saveProgress = async (store: ProgressStore, progress: ProgressState) => {
  await store.save(progress);
};

// 带稳定错误码的房间错误；run() 捕获后按 code 下发，未标 code 的仍走 bad-request。
export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// 一房一会话仓库：房间实例换代（测试重建房间）时旧令牌自然作废，
// 不会出现孤儿令牌附着到新一代房间的座位。
const sessionStores = new WeakMap<GameRoom, PlayerSessionStore>();
const sessionsFor = (room: GameRoom): PlayerSessionStore => {
  let store = sessionStores.get(room);
  if (!store) {
    store = new PlayerSessionStore();
    sessionStores.set(room, store);
  }
  return store;
};

const accountSessionStores = new WeakMap<GameRoom, AccountSessionStore>();
const accountSessionsFor = (room: GameRoom): AccountSessionStore => {
  let store = accountSessionStores.get(room);
  if (!store) {
    store = new AccountSessionStore();
    accountSessionStores.set(room, store);
  }
  return store;
};

// 管理员登录失败限流（随房间实例生命周期）。
const adminLimiters = new WeakMap<GameRoom, FailureRateLimiter>();
const adminLimiterFor = (room: GameRoom): FailureRateLimiter => {
  let limiter = adminLimiters.get(room);
  if (!limiter) {
    limiter = new FailureRateLimiter();
    adminLimiters.set(room, limiter);
  }
  return limiter;
};

// 账号密码失败限流（按昵称维度，随房间实例生命周期）。
const accountLimiters = new WeakMap<GameRoom, AccountRateLimiter>();
const accountLimiterFor = (room: GameRoom): AccountRateLimiter => {
  let limiter = accountLimiters.get(room);
  if (!limiter) {
    limiter = new AccountRateLimiter();
    accountLimiters.set(room, limiter);
  }
  return limiter;
};

const accountActionLimiters = new WeakMap<GameRoom, ActionRateLimiter>();
const accountActionLimiterFor = (room: GameRoom): ActionRateLimiter => {
  let limiter = accountActionLimiters.get(room);
  if (!limiter) {
    limiter = new ActionRateLimiter();
    accountActionLimiters.set(room, limiter);
  }
  return limiter;
};

const adminAccountActionLimiters = new WeakMap<GameRoom, ActionRateLimiter>();
const adminAccountActionLimiterFor = (room: GameRoom): ActionRateLimiter => {
  let limiter = adminAccountActionLimiters.get(room);
  if (!limiter) {
    limiter = new ActionRateLimiter(20);
    adminAccountActionLimiters.set(room, limiter);
  }
  return limiter;
};

const requireSeatId = (socket: Socket): SeatId => {
  const seatId = socket.data.seatId as SeatId | undefined;
  if (!seatId) throw new Error("请先加入房间");
  return seatId;
};

const handleTimerFailure = (ctx: HandlerContext) => {
  clearAllTimers(ctx.room);
  failByTimeout(ctx.room);
  ctx.agentRuntime?.onResult(ctx.room);
  emitStateToAll(ctx.io, ctx.room);
};

const gameFlowPhases = new Set<GameRoom["phase"]>(["levelSelect", "discussion", "placing", "reveal", "result"]);

const withClearedLevel = (progress: ProgressState, levelIndex: number): ProgressState => ({
  ...progress,
  clearedLevels: [...new Set([...progress.clearedLevels, levelIndex])].sort((a, b) => a - b)
});

const shouldUnlockAllLevels = () => {
  const raw = process.env.UNLOCK_ALL_LEVELS;
  if (raw) return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  return (process.env.NODE_ENV ?? config.nodeEnv) !== "production";
};

const isLevelUnlocked = (progress: ProgressState, levelIndex: number): boolean =>
  shouldUnlockAllLevels() || levelIndex === 1 || progress.clearedLevels.includes(levelIndex - 1);

const clearSocketSeatBindings = (io: Server) => {
  for (const connectedSocket of io.sockets.sockets.values()) {
    connectedSocket.data.seatId = undefined;
    connectedSocket.data.nick = undefined;
    connectedSocket.data.playerId = undefined;
  }
};

const clearSocketBindingForSeat = (io: Server, socketId: string | undefined, notifySessionEnded = false) => {
  if (!socketId) return;
  const connectedSocket = io.sockets.sockets.get(socketId);
  if (!connectedSocket) return;
  if (notifySessionEnded) connectedSocket.emit(ServerEvents.GameEnded);
  connectedSocket.data.seatId = undefined;
  connectedSocket.data.nick = undefined;
  connectedSocket.data.playerId = undefined;
};

const endGameAndResetRoom = (
  io: Server,
  room: GameRoom,
  registry: InMemoryAgentRegistry,
  agentRuntime?: AgentRuntime
) => {
  clearAllTimers(room);
  registry.clear();
  agentRuntime?.resetSession();
  sessionsFor(room).revokeAll();
  softResetRoom(room);
  clearSocketSeatBindings(io);
  io.emit(ServerEvents.GameEnded);
  emitStateToAll(io, room);
};

// 玩家主动“结束游戏”只结束当前 play session，不等于离开房间。
// 保留所有座位、socket 绑定、玩家会话与 AI registry，统一回到未准备大厅。
const endGameAndReturnToLobby = (io: Server, room: GameRoom, agentRuntime?: AgentRuntime) => {
  clearAllTimers(room);
  agentRuntime?.resetSession();
  resetSessionIdentity(room.identity);
  resetRoundState(room);
  room.phase = "waiting";
  room.currentLevelIndex = null;
  room.currentChallenge = null;
  room.chat = [];
  room.host = null;
  room.ready = Object.fromEntries(
    room.seats.filter((seat) => seat.kind === "agent" && seat.nick).map((seat) => [seat.id, true])
  );
  room.agentState = { seats: [], review: null };
  emitStateToAll(io, room);
};

const returnToWaitingAndReleaseSeat = (io: Server, room: GameRoom, seatId: SeatId) => {
  clearAllTimers(room);
  resetRoundState(room);
  room.phase = "waiting";
  room.currentLevelIndex = null;
  room.currentChallenge = null;
  room.chat = [];

  const seat = findSeat(room, seatId);
  if (seat) {
    releaseSeat(room, seat);
    sessionsFor(room).revokeBySeat(seatId);
  }
  refreshHostStartTimer(io, room);
  emitStateToAll(io, room);
};

const allConnectedPlayersReady = (room: GameRoom) => {
  if (room.phase !== "waiting") return false;
  const occupied = occupiedSeats(room);
  if (occupied.length < 2 || occupied.length > 4) return false;
  if (humanSeats(room).length === 0) return false;
  return occupied.every((seat) => seat.kind === "agent" || Boolean(seat.connected && room.ready[seat.id]));
};

const pickRandomReadyHost = (room: GameRoom, excludedSeatId: SeatId) => {
  const candidates = room.seats.filter(
    (seat) => seat.id !== excludedSeatId && seat.kind === "human" && seat.nick && seat.connected && room.ready[seat.id]
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]?.id ?? null;
};

const kickTimedOutHost = (io: Server, room: GameRoom, hostId: SeatId | null) => {
  if (!hostId || room.phase !== "waiting" || room.host !== hostId || !allConnectedPlayersReady(room)) return;
  const hostSeat = findSeat(room, hostId);
  if (!hostSeat?.nick) return;

  const nextHost = pickRandomReadyHost(room, hostId);
  clearHostStartTimer(room);
  clearSocketBindingForSeat(io, hostSeat.socketId, true);
  releaseSeat(room, hostSeat);
  sessionsFor(room).revokeBySeat(hostId);
  room.host = nextHost;
  emitStateToAll(io, room);
};

const refreshHostStartTimer = (io: Server, room: GameRoom) => {
  clearHostStartTimer(room);
  if (!allConnectedPlayersReady(room) || !room.host) return;
  const hostId = room.host;
  startHostStartTimer(room, config.hostStartGraceMs, () => kickTimedOutHost(io, room, hostId));
};

const afterRevealIfNeeded = async (ctx: HandlerContext) => {
  if (ctx.room.phase !== "placing") return;
  if (totalPlacedCards(ctx.room) < 12) return;
  clearAllTimers(ctx.room);
  revealAndScore(ctx.room);
  ctx.agentRuntime?.onResult(ctx.room);
  if (ctx.room.revealResult?.pass && ctx.room.currentLevelIndex !== null) {
    const nextProgress = withClearedLevel(ctx.room.progress, ctx.room.currentLevelIndex);
    try {
      await saveProgress(ctx.progressStore, nextProgress);
      ctx.room.progress = nextProgress;
    } catch (error) {
      console.warn(JSON.stringify({ event: "progress:save_failed", error: String(error) }));
      ctx.io.emit(ServerEvents.RoomError, {
        code: "progress-save-failed",
        message: "通关成功，但进度保存失败，请稍后重试"
      });
    }
  }
};

// discussion → placing 转换的房间级单飞：手动“提前开始出牌”、讨论计时器
// 到期与重连恢复计时器都会进入本函数，任意两个并发触发都会让第二次
// finalizeDiscussion 经 cancelDiscussion 中止首个策略收口（2026-07-21 findings P0-1）。
// 因此同一 attempt 只允许存在一个 transition Promise：首个触发者（owner）
// 执行收口与阶段推进；后续触发等待同一 Promise 完成，但一律返回 false，
// 不重复驱动 handoff 或广播。
const placementTransitions = new WeakMap<GameRoom, { attemptId: string | null; promise: Promise<boolean> }>();

// 返回是否真的进入了 placing：讨论收口 await 期间房间可能已经换了
// attempt（返回选关 / 重选关卡），过期请求不得推进新一轮讨论（ACR-01）。
const beginPlacementWithTimers = async (ctx: HandlerContext): Promise<boolean> => {
  const room = ctx.room;
  if (room.phase !== "discussion") throw new Error("Cannot begin placement now");
  const attemptToken = room.identity.attemptId;

  const existing = placementTransitions.get(room);
  if (existing && existing.attemptId === attemptToken) {
    await existing.promise.catch(() => {});
    return false;
  }

  const promise = (async () => {
    // 首次进入收口立即冻结讨论计时器，堵死“收口期间计时器到点二次触发”。
    clearDiscussionTimer(room);
    const hasAgentSeats = room.seats.some((seat) => seat.kind === "agent" && seat.nick);
    if (hasAgentSeats) {
      room.agentState.strategyFinalizing = true;
      emitStateToAll(ctx.io, room, "strategy:finalizing");
    }
    try {
      // 讨论收口：取消未完成发言，每个 Agent 独立锁定自己的 SeatStrategy。
      await ctx.agentRuntime?.finalizeDiscussion(room);
    } finally {
      if (room.agentState.strategyFinalizing) room.agentState.strategyFinalizing = false;
    }
    if (room.phase !== "discussion" || room.identity.attemptId !== attemptToken) {
      console.warn(JSON.stringify({ event: "placement:stale_begin_discarded", attemptId: attemptToken }));
      return false;
    }
    clearAllTimers(room);
    beginPlacement(room);
    ctx.agentRuntime?.recordPhaseChange(room);
    startTurnTimer(room, () => handleTimerFailure(ctx));
    return true;
  })();

  placementTransitions.set(room, { attemptId: attemptToken, promise });
  try {
    return await promise;
  } finally {
    if (placementTransitions.get(room)?.promise === promise) placementTransitions.delete(room);
  }
};

const continueTurnOrAgentHandoff = (ctx: HandlerContext) =>
  continueTurnOrHandoff(ctx.room, {
    afterRevealIfNeeded: () => afterRevealIfNeeded(ctx),
    startTurnTimer: () => startTurnTimer(ctx.room, () => handleTimerFailure(ctx)),
    agentRegistry: ctx.agentRegistry,
    onPlacement: (seatId, segment, placed) => {
      ctx.agentRuntime?.recordPlacement(ctx.room, seatId, segment, placed);
      emitStateToAll(ctx.io, ctx.room, "agent:place");
    },
    onHintDecision: (seatId, decision, hint) => {
      ctx.agentRuntime?.recordHintDecision(ctx.room, seatId, decision, hint);
      emitStateToAll(ctx.io, ctx.room, "agent:hint");
    },
    onRaceWinner: (seatId) => ctx.agentRuntime?.keepRaceWinner(seatId)
  });

const LEVEL_SELECT_MS = 15_000;

const autoSelectRandomLevel = (ctx: HandlerContext) => {
  if (ctx.room.phase !== "levelSelect") return;
  const level = ctx.levels[Math.floor(Math.random() * ctx.levels.length)];
  if (!level) return;
  startDiscussionWithTimer(ctx, level);
  emitStateToAll(ctx.io, ctx.room);
};

const startLevelSelectWithTimer = (ctx: HandlerContext) => {
  startLevelSelectTimer(ctx.room, LEVEL_SELECT_MS, () => autoSelectRandomLevel(ctx));
};

const startDiscussionWithTimer = (ctx: HandlerContext, level: Challenge) => {
  enterDiscussion(ctx.room, level);
  ctx.agentRuntime?.onDiscussionStarted(ctx.room, () => emitStateToAll(ctx.io, ctx.room, "agent:chat"));
  startDiscussionTimer(ctx.room, () => {
    void Promise.resolve()
      .then(async () => {
        if (!(await beginPlacementWithTimers(ctx))) return;
        emitStateToAll(ctx.io, ctx.room, "discussion:timeout");
        await continueTurnOrAgentHandoff(ctx);
        emitStateToAll(ctx.io, ctx.room, "turn:handoff");
      })
      .catch((error) => {
        console.warn(JSON.stringify({ event: "timer:discussion_failed", error: String(error) }));
      });
  });
};

const resumeTimersAfterReconnect = (ctx: HandlerContext) => {
  if (ctx.room.phase === "levelSelect") {
    // Re-attach the timeout to the existing deadline instead of topping it up.
    startLevelSelectWithTimer(ctx);
    return;
  }
  if (ctx.room.phase === "discussion") {
    startDiscussionTimer(ctx.room, () => {
      void Promise.resolve()
        .then(async () => {
          if (!(await beginPlacementWithTimers(ctx))) return;
          emitStateToAll(ctx.io, ctx.room, "discussion:timeout");
          await continueTurnOrAgentHandoff(ctx);
          emitStateToAll(ctx.io, ctx.room, "turn:handoff");
        })
        .catch((error) => {
          console.warn(JSON.stringify({ event: "timer:discussion_failed", error: String(error) }));
        });
    });
    return;
  }

  if (ctx.room.phase !== "placing") return;
  if (ctx.room.pendingHint) {
    startHintTimer(ctx.room, () => {
      run(ctx.socket, async () => {
        const pendingHint = ctx.room.pendingHint;
        const hintSeatId = pendingHint?.seatId ?? requireSeatId(ctx.socket);
        applyHintDecision(ctx.room, hintSeatId, "no");
        if (pendingHint) {
          ctx.agentRuntime?.recordHintDecision(ctx.room, hintSeatId, "no", {
            cardId: pendingHint.cardId,
            segment: pendingHint.segment
          });
        }
        clearTurnTimers(ctx.room);
        await afterRevealIfNeeded(ctx);
        emitStateToAll(ctx.io, ctx.room, "hint:timeout");
        await continueTurnOrAgentHandoff(ctx);
        emitStateToAll(ctx.io, ctx.room, "turn:handoff");
      });
    });
    return;
  }

  startTurnTimer(ctx.room, () => handleTimerFailure(ctx));
};

const run = (socket: Socket, fn: () => void | Promise<void>) => {
  void Promise.resolve()
    .then(fn)
    .catch((error) => {
      const code = error instanceof RoomError ? error.code : "bad-request";
      emitRoomError(socket, code, error instanceof Error ? error.message : String(error));
    });
};

const assertRoomPassword = (password: string) => {
  if (password !== config.roomPassword) throw new RoomError("INVALID_ROOM_PASSWORD", "房间密码错误");
};

export const registerHandlers = (ctx: HandlerContext) => {
  const { io, socket, room, levels, progressStore, agentRegistry } = ctx;

  const sessions = sessionsFor(room);
  const accountSessions = accountSessionsFor(room);

  const accountProfilePayload = (account: AccountProfile): AccountProfilePayload => ({
    playerId: account.playerId,
    nickname: account.nickname,
    avatar: account.avatar,
    email: account.email,
    emailVerified: false,
    credentialVersion: account.credentialVersion,
    createdAt: account.createdAt,
    nicknameChangedAt: account.nicknameChangedAt,
    passwordChangedAt: account.passwordChangedAt
  });

  const emitAccountProfile = (account: AccountProfile) => {
    socket.emit(ServerEvents.AccountProfile, accountProfilePayload(account));
  };

  const issueAccountSession = (account: AccountProfile, revokeExisting = false) => {
    if (revokeExisting) accountSessions.revokePlayer(account.playerId);
    const credentials = accountSessions.issue(account.playerId, account.credentialVersion);
    socket.data.accountPlayerId = account.playerId;
    socket.data.accountToken = credentials.accountToken;
    socket.emit(ServerEvents.AccountSession, credentials);
    emitAccountProfile(account);
  };

  // 首次入座：附着 + 签发新会话 + 私发凭证。账号体系下传入账号的持久 playerId。
  const attachWithSession = (
    seat: (typeof room.seats)[number],
    nick: string,
    avatar?: string | null,
    playerId?: string,
    credentialVersion?: number
  ) => {
    attachSeat(room, seat, socket.id, nick, avatar);
    seat.playerId = playerId;
    socket.data.seatId = seat.id;
    socket.data.nick = seat.nick;
    socket.data.playerId = playerId;
    const cred = sessions.issue(
      seat.id,
      playerId ? { playerId, credentialVersion } : undefined
    );
    socket.emit(ServerEvents.PlayerSession, { ...cred, seatId: seat.id });
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  // 会话重连/接管：先验证、附着并轮换成功，最后才断开旧 socket。
  const takeOverSeat = (seat: (typeof room.seats)[number], playerId: string, avatar?: string | null) => {
    const staleSocketId = seat.socketId;
    attachSeat(room, seat, socket.id, seat.nick ?? "", avatar ?? seat.avatar);
    seat.playerId = playerId;
    socket.data.seatId = seat.id;
    socket.data.nick = seat.nick;
    socket.data.playerId = playerId;
    if (sessions.isAdmin(playerId)) {
      socket.data.role = "admin";
      socket.emit(ServerEvents.AdminSession, { authenticated: true });
    }
    const reconnectToken = sessions.rotate(playerId);
    if (reconnectToken) {
      socket.emit(ServerEvents.PlayerSession, { playerId, reconnectToken, seatId: seat.id });
    }
    if (staleSocketId && staleSocketId !== socket.id) {
      io.sockets.sockets.get(staleSocketId)?.disconnect(true);
    }
    resumeTimersAfterReconnect(ctx);
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  const resolveSessionSeat = (playerId: string, reconnectToken: string) => {
    const storedVersion = sessions.credentialVersionOf(playerId);
    const account = storedVersion === null ? null : ctx.accountStore?.getByPlayerId(playerId);
    if (storedVersion !== null && (!account || account.status !== "active")) {
      sessions.revoke(playerId);
      return null;
    }
    const seatId = sessions.verify(playerId, reconnectToken, account?.credentialVersion);
    if (!seatId) return null;
    const seat = findSeat(room, seatId);
    if (!seat || !seat.nick) {
      // 会话指向的座位已被释放（防御路径），彻底作废该会话。
      sessions.revoke(playerId);
      return null;
    }
    return seat;
  };

  const autoReconnectFromAuth = () => {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const playerId = typeof auth?.playerId === "string" ? auth.playerId : null;
    const reconnectToken = typeof auth?.reconnectToken === "string" ? auth.reconnectToken : null;
    if (!playerId || !reconnectToken) return;

    const seat = resolveSessionSeat(playerId, reconnectToken);
    if (!seat) {
      emitRoomError(socket, "INVALID_PLAYER_SESSION", "玩家会话无效或已撤销，请重新加入");
      return;
    }
    takeOverSeat(seat, playerId);
    const profile = ctx.accountStore?.getProfile(playerId);
    if (profile) {
      // 兼容升级前只保存了座位令牌的标签页，也修复“账号令牌失效但
      // 座位令牌仍有效”的边缘状态：有效座位可重新派生资料维护会话。
      if (socket.data.accountPlayerId === playerId) emitAccountProfile(profile);
      else issueAccountSession(profile);
    }
  };

  const autoRestoreAccountFromAuth = () => {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const playerId = typeof auth?.accountPlayerId === "string" ? auth.accountPlayerId : null;
    const accountToken = typeof auth?.accountToken === "string" ? auth.accountToken : null;
    if (!playerId || !accountToken) return;
    const profile = ctx.accountStore?.getProfile(playerId);
    if (
      !profile ||
      profile.status !== "active" ||
      !accountSessions.verify(playerId, accountToken, profile.credentialVersion)
    ) {
      accountSessions.revokePlayer(playerId);
      emitRoomError(socket, "INVALID_ACCOUNT_SESSION", "账号会话已失效，请重新登录");
      return;
    }
    socket.data.accountPlayerId = playerId;
    socket.data.accountToken = accountToken;
    emitAccountProfile(profile);
  };

  const requireAccountStore = (): AccountStore => {
    if (!ctx.accountStore?.isAvailable()) {
      throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
    }
    return ctx.accountStore;
  };

  const requireActiveAccount = (): AccountProfile => {
    const playerId = socket.data.accountPlayerId as string | undefined;
    const accountToken = socket.data.accountToken as string | undefined;
    if (!playerId || !accountToken) {
      throw new RoomError("ACCOUNT_SESSION_REQUIRED", "请先登录账号");
    }
    const profile = requireAccountStore().getProfile(playerId);
    if (!profile || profile.status !== "active") {
      sessions.revoke(playerId);
      accountSessions.revokePlayer(playerId);
      throw new RoomError("ACCOUNT_SESSION_REQUIRED", "账号会话已失效，请重新登录");
    }
    if (!accountSessions.verify(playerId, accountToken, profile.credentialVersion)) {
      accountSessions.revokePlayer(playerId);
      throw new RoomError("ACCOUNT_SESSION_REQUIRED", "账号会话已失效，请重新登录");
    }
    return profile;
  };

  const issueCurrentAccountSession = (account: AccountProfile, seat: (typeof room.seats)[number]) => {
    seat.playerId = account.playerId;
    socket.data.playerId = account.playerId;
    socket.data.seatId = seat.id;
    socket.data.nick = account.nickname;
    const credentials = sessions.issue(seat.id, {
      playerId: account.playerId,
      credentialVersion: account.credentialVersion
    });
    socket.emit(ServerEvents.PlayerSession, { ...credentials, seatId: seat.id });
    emitAccountProfile(account);
  };

  const enterRoomWithAccount = (account: AccountProfile) => {
    const existingSeat = room.seats.find(
      (candidate) => candidate.kind === "human" && candidate.playerId === account.playerId && candidate.nick
    );
    if (existingSeat) {
      if (sessions.isAdminSeat(existingSeat.id)) {
        throw new RoomError("NICK_IN_USE", "该昵称正在使用中，请更换昵称");
      }
      const staleSocketId = existingSeat.socketId;
      attachSeat(room, existingSeat, socket.id, account.nickname, account.avatar);
      issueCurrentAccountSession(account, existingSeat);
      if (staleSocketId && staleSocketId !== socket.id) io.sockets.sockets.get(staleSocketId)?.disconnect(true);
      resumeTimersAfterReconnect(ctx);
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
      return;
    }

    if (room.phase !== "waiting") throw new RoomError("ROOM_IN_PROGRESS", "对局进行中，不能加入新座位");
    if (
      room.seats.some(
        (candidate) =>
          candidate.nick && normalizeNickname(candidate.nick) === normalizeNickname(account.nickname)
      )
    ) {
      throw new RoomError("NICK_IN_USE", "该昵称正在使用中，请更换昵称");
    }
    const seat = findEmptySeat(room);
    if (!seat) throw new RoomError("ROOM_FULL", "房间已满");
    attachSeat(room, seat, socket.id, account.nickname, account.avatar);
    issueCurrentAccountSession(account, seat);
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  socket.on(ClientEvents.AccountRegister, (payload) =>
    run(socket, async () => {
      const parsed = accountRegisterSchema.parse(payload);
      // 廉价共享门槛必须在任何账号查询或 scrypt 之前完成。
      assertRoomPassword(parsed.roomPassword);
      const actionKey = `register:${socket.handshake.address}`;
      if (!accountActionLimiterFor(room).take(actionKey)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      if (room.phase !== "waiting") throw new RoomError("ROOM_IN_PROGRESS", "对局进行中，不能注册并加入");
      if (!findEmptySeat(room)) throw new RoomError("ROOM_FULL", "房间已满");
      if (
        room.seats.some(
          (candidate) =>
            candidate.nick && normalizeNickname(candidate.nick) === normalizeNickname(parsed.nickname)
        )
      ) {
        throw new RoomError("NICKNAME_UNAVAILABLE", "该昵称不可用");
      }

      const result = await requireAccountStore().register({
        email: parsed.email,
        password: parsed.password,
        nickname: parsed.nickname,
        avatar: parsed.avatar ?? null
      });
      if (!result.ok) {
        if (result.reason === "store_unavailable") {
          throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
        }
        if (result.reason === "email_taken") throw new RoomError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册");
        throw new RoomError("NICKNAME_UNAVAILABLE", "该昵称不可用");
      }
      issueAccountSession(result.account);
      try {
        enterRoomWithAccount(result.account);
      } catch (error) {
        // 账号已经先于房间副作用持久化。若 scrypt/写盘期间房间被占满或开局，
        // 必须明确告知客户端“账号已创建”，避免用户把后续 EMAIL_ALREADY_REGISTERED
        // 误认为首次注册失败且账号状态未知。
        if (
          error instanceof RoomError &&
          ["ROOM_FULL", "ROOM_IN_PROGRESS", "NICK_IN_USE"].includes(error.code)
        ) {
          emitAccountProfile(result.account);
          socket.emit(ServerEvents.AccountActionResult, {
            action: "register",
            success: true,
            message: `账号已创建，但${error.message}；请稍后使用邮箱登录`
          });
          throw new RoomError("ACCOUNT_CREATED_ROOM_ENTRY_FAILED", `账号已创建，但${error.message}；请稍后登录进入`);
        }
        throw error;
      }
    })
  );

  socket.on(ClientEvents.AccountLogin, (payload) =>
    run(socket, async () => {
      const parsed = accountLoginSchema.parse(payload);
      // 房间密码错误时不能触达账号仓库或触发 scrypt。
      assertRoomPassword(parsed.roomPassword);
      if (!accountActionLimiterFor(room).take(`login:${socket.handshake.address}`)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      const limiterKey = normalizeEmail(parsed.email).toLowerCase();
      if (accountLimiterFor(room).blocked(limiterKey)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      const result = await requireAccountStore().authenticate({ email: parsed.email, password: parsed.password });
      if (!result.ok) {
        if (result.reason === "store_unavailable") {
          throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
        }
        accountLimiterFor(room).fail(limiterKey);
        throw new RoomError("ACCOUNT_INVALID_CREDENTIALS", "邮箱或密码不正确");
      }
      accountLimiterFor(room).reset(limiterKey);
      issueAccountSession(result.account);
      enterRoomWithAccount(result.account);
    })
  );

  socket.on(ClientEvents.AccountProfileUpdate, (payload) =>
    run(socket, async () => {
      const parsed = accountProfileUpdateSchema.parse(payload);
      const current = requireActiveAccount();
      if (!accountActionLimiterFor(room).take(`profile:${current.playerId}`)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      if (
        room.seats.some(
          (candidate) =>
            candidate.kind === "agent" &&
            candidate.nick &&
            normalizeNickname(candidate.nick) === normalizeNickname(parsed.nickname)
        )
      ) {
        throw new RoomError("NICKNAME_UNAVAILABLE", "该昵称不可用");
      }
      const result = await requireAccountStore().updateProfile(current.playerId, {
        nickname: parsed.nickname,
        avatar: parsed.avatar
      });
      if (!result.ok) {
        if (result.reason === "nickname_unavailable") throw new RoomError("NICKNAME_UNAVAILABLE", "该昵称不可用");
        if (result.reason === "store_unavailable") {
          throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
        }
        throw new RoomError("ACCOUNT_SESSION_REQUIRED", "账号会话已失效，请重新登录");
      }
      const seat = room.seats.find((candidate) => candidate.playerId === current.playerId);
      if (seat) {
        seat.nick = result.account.nickname;
        seat.avatar = result.account.avatar;
      }
      if (socket.data.seatId) socket.data.nick = result.account.nickname;
      emitAccountProfile(result.account);
      socket.emit(ServerEvents.AccountActionResult, {
        action: "profileUpdate",
        success: true,
        message: parsed.avatar === undefined ? "昵称已更新" : "昵称与头像资料已更新"
      });
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.AccountPasswordChange, (payload) =>
    run(socket, async () => {
      const parsed = accountPasswordChangeSchema.parse(payload);
      const current = requireActiveAccount();
      if (!accountActionLimiterFor(room).take(`password:${current.playerId}`)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      const result = await requireAccountStore().changePassword(
        current.playerId,
        parsed.currentPassword,
        parsed.newPassword
      );
      if (!result.ok) {
        if (result.reason === "invalid_credentials") {
          accountLimiterFor(room).fail(`password:${current.playerId}`);
          throw new RoomError("ACCOUNT_INVALID_CREDENTIALS", "当前密码不正确");
        }
        throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
      }
      accountLimiterFor(room).reset(`password:${current.playerId}`);
      issueAccountSession(result.account, true);
      const seat = findSeat(room, socket.data.seatId as SeatId | undefined);
      if (seat?.playerId === result.account.playerId) issueCurrentAccountSession(result.account, seat);
      socket.emit(ServerEvents.AccountActionResult, {
        action: "passwordChange",
        success: true,
        message: "密码已更新，其他会话已撤销"
      });
    })
  );

  socket.on(ClientEvents.AccountEmailChange, (payload) =>
    run(socket, async () => {
      const parsed = accountEmailChangeSchema.parse(payload);
      const current = requireActiveAccount();
      if (!accountActionLimiterFor(room).take(`email:${current.playerId}`)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      const result = await requireAccountStore().changeEmail(current.playerId, parsed.currentPassword, parsed.newEmail);
      if (!result.ok) {
        if (result.reason === "invalid_credentials") {
          accountLimiterFor(room).fail(`email:${current.playerId}`);
          throw new RoomError("ACCOUNT_INVALID_CREDENTIALS", "当前密码不正确");
        }
        if (result.reason === "email_taken") throw new RoomError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册");
        throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
      }
      accountLimiterFor(room).reset(`email:${current.playerId}`);
      issueAccountSession(result.account, true);
      const seat = findSeat(room, socket.data.seatId as SeatId | undefined);
      if (seat?.playerId === result.account.playerId) issueCurrentAccountSession(result.account, seat);
      socket.emit(ServerEvents.AccountActionResult, {
        action: "emailChange",
        success: true,
        message: "登录邮箱已更新，其他会话已撤销"
      });
    })
  );

  socket.on(ClientEvents.AccountSessionsRevokeOthers, (payload) =>
    run(socket, () => {
      accountSessionsRevokeOthersSchema.parse(payload ?? {});
      const current = requireActiveAccount();
      if (!accountActionLimiterFor(room).take(`sessions:${current.playerId}`)) {
        throw new RoomError("ACCOUNT_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      }
      const accountToken = socket.data.accountToken as string;
      accountSessions.revokeOthers(current.playerId, accountToken);
      const seat = findSeat(room, socket.data.seatId as SeatId | undefined);
      if (seat?.playerId === current.playerId) issueCurrentAccountSession(current, seat);
      socket.emit(ServerEvents.AccountActionResult, {
        action: "revokeOthers",
        success: true,
        message: "其他会话已撤销"
      });
    })
  );

  socket.on(ClientEvents.PlayerJoin, (payload) =>
    run(socket, async () => {
      const parsed = playerJoinSchema.parse(payload);

      // 会话分支：session 本身即凭证（当初经房间密码换来），不重复校验房间密码与个人密码。
      if ("session" in parsed) {
        const seat = resolveSessionSeat(parsed.session.playerId, parsed.session.reconnectToken);
        if (!seat) throw new RoomError("INVALID_PLAYER_SESSION", "玩家会话无效或已撤销，请重新加入");
        takeOverSeat(seat, parsed.session.playerId, parsed.avatar);
        return;
      }

      const { nick, avatar } = parsed;
      // 账号分支：房间密码是注册/登录的前置门槛，失败不触达账号层（ADR-0006）。
      assertRoomPassword(parsed.password);

      if (!ctx.accountStore) {
        // 无账号仓库（测试基建）：维持 ADR-0005 语义——无会话的同昵称一律拒绝。
        const now = Date.now();
        const nickTaken = room.seats.some(
          (seat) => seat.nick === nick && (seat.connected || (seat.holdUntil !== undefined && seat.holdUntil > now))
        );
        if (nickTaken) {
          throw new RoomError("NICK_IN_USE", "该昵称正在使用中，请更换昵称；如果这是你的座位，请从原浏览器重连");
        }
        if (room.phase !== "waiting") throw new RoomError("ROOM_IN_PROGRESS", "对局进行中，不能加入新座位");

        const seat = findEmptySeat(room);
        if (!seat) throw new RoomError("ROOM_FULL", "房间已满");
        attachWithSession(seat, nick, avatar);
        return;
      }
      throw new RoomError("ACCOUNT_REGISTRATION_REQUIRED", "请使用邮箱登录或注册");
    })
  );

  socket.on(ClientEvents.PlayerLeave, () =>
    run(socket, () => {
      const seat = findSeat(room, requireSeatId(socket));
      if (!seat) return;
      if (room.phase === "discussion" || room.phase === "placing") {
        clearAllTimers(room);
        failByPlayerLeft(room);
        ctx.agentRuntime?.onResult(room);
      }
      releaseSeat(room, seat);
      sessions.revokeBySeat(seat.id);
      socket.data.seatId = undefined;
      socket.data.nick = undefined;
      socket.data.playerId = undefined;
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.PlayerReady, () =>
    run(socket, () => {
      const seatId = requireSeatId(socket);
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以准备");
      room.ready[seatId] = !room.ready[seatId];
      if (room.ready[seatId] && !room.host) room.host = seatId;
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.HostAddAgent, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以添加 AI");
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以添加 AI");
      if (room.seats.filter((seat) => seat.kind === "agent" && seat.nick).length >= 3) throw new Error("最多只能添加 3 个 AI");

      const seat = findEmptySeat(room);
      if (!seat) throw new Error("房间已满");

      const existingNumbers = new Set(
        room.seats
          .filter((candidate) => candidate.kind === "agent" && candidate.nick?.startsWith("AI-"))
          .map((candidate) => Number(candidate.nick?.slice(3)))
          .filter(Number.isInteger)
      );
      let nextNumber = 1;
      while (existingNumbers.has(nextNumber)) nextNumber += 1;

      const agentId = randomUUID();
      seat.kind = "agent";
      seat.nick = `AI-${nextNumber}`;
      seat.agentId = agentId;
      seat.connected = true;
      seat.socketId = undefined;
      seat.holdUntil = undefined;
      room.ready[seat.id] = true;
      // 模型 Agent：出牌 + hint 消费同一次 TurnDecision；未配置 Provider 时
      // orchestrator 启发式兜底行为与脚本 Agent 一致。
      agentRegistry.register(agentId, ctx.agentRuntime?.createSeatAgent(room, seat.id) ?? createScriptedAgent());
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.HostRemoveAgent, (payload) =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以移除 AI");
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以移除 AI");
      const { seatId } = hostRemoveAgentSchema.parse(payload);
      const seat = findSeat(room, seatId);
      if (!seat || seat.kind !== "agent" || !seat.agentId) throw new Error("该座位不是 AI");

      agentRegistry.unregister(seat.agentId);
      ctx.agentRuntime?.dropSeat(seat.id);
      releaseSeat(room, seat);
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );
  socket.on(ClientEvents.SettingsUpdate, (payload) =>
    run(socket, async () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以修改设置");
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以修改设置");
      const patch = settingsUpdateSchema.parse(payload);
      const nextSettings = { ...room.settings, ...patch, capacity: 4 as const };
      const nextProgress = { ...room.progress, settings: nextSettings };
      await saveProgress(progressStore, nextProgress);
      room.settings = nextSettings;
      room.capacity = nextSettings.capacity;
      room.progress = nextProgress;
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameStart, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以开始游戏");
      if (!canStartGame(room)) throw new Error("至少需要 2 名玩家且所有真人已准备");
      clearHostStartTimer(room);
      enterLevelSelect(room);
      startLevelSelectWithTimer(ctx);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.HostSelectLevel, (payload) =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以选关");
      const { levelIndex } = hostSelectLevelSchema.parse(payload);
      const level = levels.find((candidate) => candidate.levelIndex === levelIndex);
      if (!level) throw new Error("关卡不存在");
      // 顺序解锁：第 1 关始终开放，其余关卡需上一关已通关才可选。
      if (!isLevelUnlocked(room.progress, levelIndex)) throw new Error("该关卡尚未解锁");
      clearLevelSelectTimer(room);
      startDiscussionWithTimer(ctx, level);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameBeginPlacement, () =>
    run(socket, async () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以提前开始出牌");
      if (!(await beginPlacementWithTimers(ctx))) return;
      void continueTurnOrAgentHandoff(ctx).then(() => emitStateToAll(io, room));
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.ChatSend, (payload) =>
    run(socket, () => {
      const seatId = requireSeatId(socket);
      if (room.phase !== "discussion") throw new Error("只有讨论阶段可以聊天");
      const { text } = chatSendSchema.parse(payload);
      const seat = findSeat(room, seatId);
      const message = appendChatMessage(room, {
        senderSeatId: seatId,
        kind: "human",
        nick: seat?.nick ?? seatId,
        text
      });
      ctx.agentRuntime?.recordPublicChat(room, message);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.RoomSync, () =>
    run(socket, () => {
      requireSeatId(socket);
      console.log(JSON.stringify({ event: "room:sync_requested", socketId: socket.id, stateVersion: room.stateVersion }));
      emitStateToSocket(socket, room, "room:sync");
    })
  );

  socket.on(ClientEvents.CardPlace, (payload) =>
    run(socket, async () => {
      const seatId = requireSeatId(socket);
      const parsed = cardPlaceSchema.parse(payload);
      console.log(
        JSON.stringify({
          event: "card:place_received",
          seatId,
          cardId: parsed.cardId,
          segment: parsed.segment,
          stateVersion: room.stateVersion,
          turn: room.turn,
          pendingHint: room.pendingHint
            ? {
                seatId: room.pendingHint.seatId,
                cardId: room.pendingHint.cardId,
                segment: room.pendingHint.segment
              }
            : null
        })
      );
      const placed = applyPlacement(room, seatId, parsed);
      // 真人可能在 Agent 的 race 模型请求完成前先落子；立即取消所有在途
      // turn 请求，迟到响应不得继续占用预算或写入缓存。
      ctx.agentRuntime?.cancelTurnRequests("turn_changed");
      ctx.agentRuntime?.recordPlacement(room, seatId, parsed.segment, placed);
      clearTurnTimers(room);
      if (room.pendingHint) {
        startHintTimer(room, () => {
          run(socket, async () => {
            const pendingHint = room.pendingHint;
            const hintSeatId = pendingHint?.seatId ?? seatId;
            applyHintDecision(room, hintSeatId, "no");
            if (pendingHint) {
              ctx.agentRuntime?.recordHintDecision(room, hintSeatId, "no", {
                cardId: pendingHint.cardId,
                segment: pendingHint.segment
              });
            }
            clearTurnTimers(room);
            await afterRevealIfNeeded(ctx);
            // 先广播提示窗口已按 No 关闭，再等待下一位（可能是 AI）思考。
            emitStateToAll(io, room, "hint:timeout");
            await continueTurnOrAgentHandoff(ctx);
            emitStateToAll(io, room, "turn:handoff");
          });
        });
      } else {
        // 没有提示窗口时也先确认真人落子，避免等待 AI 后才刷新画面。
        emitStateToAll(io, room, "card:place");
        await continueTurnOrAgentHandoff(ctx);
        // handoff 会为下一位真人/Agent 启动新的公共回合计时器，需再同步一次。
        emitStateToAll(io, room, "turn:handoff");
      }
      if (room.pendingHint) emitStateToAll(io, room, "card:place");
      console.log(
        JSON.stringify({
          event: "card:place_broadcast_complete",
          seatId,
          stateVersion: room.stateVersion,
          turn: room.turn,
          pendingHint: room.pendingHint
            ? {
                seatId: room.pendingHint.seatId,
                cardId: room.pendingHint.cardId,
                segment: room.pendingHint.segment
              }
            : null
        })
      );
    })
  );

  socket.on(ClientEvents.HintDecide, (payload) =>
    run(socket, async () => {
      const seatId = requireSeatId(socket);
      const { decision } = hintDecideSchema.parse(payload);
      const pendingHint = room.pendingHint;
      applyHintDecision(room, seatId, decision);
      if (pendingHint) {
        ctx.agentRuntime?.recordHintDecision(room, seatId, decision, {
          cardId: pendingHint.cardId,
          segment: pendingHint.segment
        });
      }
      clearTurnTimers(room);
      await afterRevealIfNeeded(ctx);
      // 选择已生效时立即关闭弹窗；下一位 AI 的思考和落子在后续状态中广播。
      emitStateToAll(io, room, "hint:decide");
      await continueTurnOrAgentHandoff(ctx);
      emitStateToAll(io, room, "turn:handoff");
    })
  );

  socket.on(ClientEvents.GameContinueToResult, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以继续");
      if (room.phase !== "reveal") throw new Error("当前阶段无法继续");
      enterResultAfterReveal(room);
      ctx.agentRuntime?.recordPhaseChange(room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameRetry, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以重试");
      if (!room.currentChallenge) throw new Error("没有当前关卡");
      startDiscussionWithTimer(ctx, room.currentChallenge);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameNext, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以进入下一关");
      if (room.currentLevelIndex === null) throw new Error("没有当前关卡");
      if (room.phase !== "result" || !room.revealResult?.pass) throw new Error("只有通关后才能进入下一关");
      const next = levels.find((level) => level.levelIndex === room.currentLevelIndex! + 1);
      if (!next) throw new Error("没有下一关了");
      startDiscussionWithTimer(ctx, next);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameEnd, () =>
    run(socket, () => {
      requireSeatId(socket);
      if (!gameFlowPhases.has(room.phase)) throw new Error("当前阶段无法结束游戏");
      ctx.agentRuntime?.cancelDiscussion();
      endGameAndReturnToLobby(io, room, ctx.agentRuntime);
    })
  );

  socket.on(ClientEvents.HostBackToLevelSelect, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以返回选关");
      if (!["discussion", "placing", "reveal", "result"].includes(room.phase)) throw new Error("当前阶段无法返回选关");
      ctx.agentRuntime?.cancelDiscussion();
      // 返回选关即放弃本 levelRun：即便重选同一关也是全新 run，
      // 不继承旧 RetryBrief；只有 GameRetry 沿用 levelRunId（ACR-03）。
      if (room.identity.levelRunId) ctx.agentRuntime?.memory.closeLevelRun(room.identity.levelRunId);
      closeLevelRun(room.identity);
      clearAllTimers(room);
      resetRoundState(room);
      room.currentLevelIndex = null;
      room.currentChallenge = null;
      room.chat = [];
      room.phase = "levelSelect";
      room.phaseVersion += 1;
      startLevelSelectWithTimer(ctx);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.RoomReset, () =>
    run(socket, () => {
      if ((process.env.NODE_ENV ?? config.nodeEnv) === "production") throw new Error("生产环境不允许重置房间");
      ctx.agentRuntime?.cancelDiscussion();
      clearAllTimers(room);
      agentRegistry.clear();
      ctx.agentRuntime?.resetSession();
      sessions.revokeAll();
      accountSessions.revokeAll();
      // room:reset 仅存在于非生产环境，也代表测试/本地房间代际切换；
      // 连同房间级限流状态一起清理，避免上一轮场景污染下一轮。
      adminLimiters.delete(room);
      accountLimiters.delete(room);
      accountActionLimiters.delete(room);
      adminAccountActionLimiters.delete(room);
      softResetRoom(room);
      emitStateToAll(io, room);
      // Sever every other connection too. A test browser torn down without a
      // WebSocket close frame leaves its socket half-open server-side for up
      // to pingInterval+pingTimeout; that ghost keeps its seat nick flagged
      // `connected` and rejects the next joiner with 该昵称已在房间中. Reset
      // means a clean slate, so lingering connections go as well.
      for (const other of io.sockets.sockets.values()) {
        if (other.id !== socket.id) other.disconnect(true);
      }
    })
  );

  const emitEnterConfirm = () => {
    socket.emit(ServerEvents.AdminEnterConfirmRequired, {
      phase: room.phase,
      humanSeatCount: room.seats.filter((seat) => seat.kind === "human" && seat.nick).length,
      inGame: room.phase !== "waiting",
      stateVersion: room.stateVersion
    });
  };

  // 原子接管：清运行态 → 通知并请出所有在座者 → 撤销全部会话 →
  // softResetRoom 重建 → 管理员入座为房主 → 最后才断开被踢 socket
  // （此时其 disconnect 处理器查不到持有座位，自然 no-op）。
  const seizeRoomByAdmin = () => {
    const beforePhase = room.phase;
    const beforeVersion = room.stateVersion;
    ctx.agentRuntime?.cancelDiscussion();
    ctx.agentRuntime?.resetSession();
    clearAllTimers(room);
    agentRegistry.clear();

    const kickedSockets = room.seats
      .map((seat) =>
        seat.socketId && seat.socketId !== socket.id ? io.sockets.sockets.get(seat.socketId) : undefined
      )
      .filter((candidate): candidate is Socket => Boolean(candidate));
    for (const kicked of kickedSockets) {
      kicked.emit(ServerEvents.GameAdminSeized, {});
      kicked.emit(ServerEvents.PlayerKicked, { reason: "ADMIN_SEIZED_ROOM" });
    }

    sessions.revokeAll();
    clearSocketSeatBindings(io);
    softResetRoom(room);

    const seat = room.seats[0];
    attachSeat(room, seat, socket.id, (socket.data.adminNick as string | undefined) ?? "管理员", socket.data.adminAvatar as string | undefined);
    room.host = seat.id;
    socket.data.seatId = seat.id;
    socket.data.nick = seat.nick;
    const cred = sessions.issue(seat.id, { isAdmin: true });
    socket.emit(ServerEvents.PlayerSession, { ...cred, seatId: seat.id });

    for (const kicked of kickedSockets) {
      kicked.disconnect(true);
    }
    emitStateToAll(io, room);
    console.log(
      JSON.stringify({
        event: "admin:seize_room",
        beforePhase,
        beforeStateVersion: beforeVersion,
        stateVersion: room.stateVersion,
        kicked: kickedSockets.length
      })
    );
  };

  const requestAdminRoomEntry = () => {
    // 已有管理员玩家会话且座位仍保留时，直接恢复，不清场。
    const adminPlayerId = sessions.findAdminPlayerId();
    if (adminPlayerId) {
      const seatId = sessions.seatOf(adminPlayerId);
      const seat = seatId ? findSeat(room, seatId) : undefined;
      if (seat?.nick) {
        takeOverSeat(seat, adminPlayerId);
        return;
      }
    }
    if (room.seats.some((seat) => seat.kind === "human" && seat.nick)) {
      emitEnterConfirm();
      return;
    }
    seizeRoomByAdmin();
  };

  socket.on(ClientEvents.AdminLogin, (payload) =>
    run(socket, () => {
      const parsed = adminLoginSchema.parse(payload);
      if (!isAdminConfigured()) throw new RoomError("ADMIN_DISABLED", "管理员登录未启用");
      const limiter = adminLimiterFor(room);
      if (limiter.blocked()) throw new RoomError("ADMIN_RATE_LIMITED", "尝试过于频繁，请稍后再试");
      if (!verifyAdminCredentials(parsed.username, parsed.password)) {
        limiter.fail();
        throw new RoomError("ADMIN_UNAUTHORIZED", "管理员账号或密码错误");
      }
      limiter.reset();
      socket.data.role = "admin";
      socket.data.adminOperator = parsed.username;
      socket.data.adminNick = parsed.nick?.trim() || "管理员";
      socket.data.adminAvatar = parsed.avatar ?? undefined;
      socket.emit(ServerEvents.AdminSession, { authenticated: true });
      // 后台管理登录不占座、不清场；旧客户端省略 intent 时保持原行为。
      if (parsed.intent === "manage") {
        emitStateToSocket(socket, room, "admin:login");
        return;
      }
      requestAdminRoomEntry();
    })
  );

  socket.on(ClientEvents.AdminEnterRoom, (payload) =>
    run(socket, () => {
      if (socket.data.role !== "admin") throw new RoomError("ADMIN_UNAUTHORIZED", "请先登录管理员账号");
      const parsed = adminEnterRoomSchema.parse(payload ?? {});
      socket.data.adminNick = parsed.nick?.trim() || socket.data.adminNick || "管理员";
      socket.data.adminAvatar = parsed.avatar ?? socket.data.adminAvatar;
      requestAdminRoomEntry();
    })
  );

  const requireAdminAccounts = () => {
    if (socket.data.role !== "admin") throw new RoomError("ADMIN_UNAUTHORIZED", "请先登录管理员账号");
    return requireAccountStore();
  };

  const removeAccountPresence = (
    playerId: string,
    reason: "ACCOUNT_FORCE_LOGOUT" | "ACCOUNT_DISABLED" | "ACCOUNT_DELETED"
  ) => {
    sessions.revoke(playerId);
    accountSessions.revokePlayer(playerId);
    const target = room.seats.find((candidate) => candidate.playerId === playerId);
    if (!target) return;
    const targetSocket = target.socketId ? io.sockets.sockets.get(target.socketId) : undefined;
    if (room.phase !== "waiting") {
      ctx.agentRuntime?.cancelDiscussion();
      clearAllTimers(room);
      resetRoundState(room);
      room.phase = "waiting";
      room.currentLevelIndex = null;
      room.currentChallenge = null;
      room.chat = [];
      room.ready = {};
    }
    targetSocket?.emit(ServerEvents.PlayerKicked, { reason });
    if (targetSocket) {
      targetSocket.data.seatId = undefined;
      targetSocket.data.nick = undefined;
      targetSocket.data.playerId = undefined;
    }
    releaseSeat(room, target);
    targetSocket?.disconnect(true);
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  const takeAdminAccountAction = () => {
    if (!adminAccountActionLimiterFor(room).take(socket.id)) {
      throw new RoomError("ADMIN_RATE_LIMITED", "管理员操作过于频繁，请稍后再试");
    }
  };

  const adminAuditSuffix = (stored: boolean) =>
    stored ? "" : "；审计文件暂不可写，完整记录已写入服务日志";

  const beginAdminAudit = (
    store: AccountStore,
    entry: Omit<AccountAdminAuditEntry, "auditId" | "result">
  ): Omit<AccountAdminAuditEntry, "result"> => {
    const audit = { ...entry, auditId: randomUUID() };
    if (!store.appendAdminAudit({ ...audit, result: "pending" })) {
      throw new RoomError("ACCOUNT_AUDIT_UNAVAILABLE", "审计存储不可用，管理员写操作已拒绝");
    }
    return audit;
  };

  const completeAdminAudit = (
    store: AccountStore,
    audit: Omit<AccountAdminAuditEntry, "result">,
    result: "success" | "failure"
  ) => store.appendAdminAudit({ ...audit, result });

  socket.on(ClientEvents.AdminAccountsList, (payload) =>
    run(socket, () => {
      const parsed = adminAccountsListSchema.parse(payload ?? {});
      const store = requireAdminAccounts();
      const accounts = store.listAccounts(parsed).map((account) => {
        const seat = room.seats.find((candidate) => candidate.playerId === account.playerId && candidate.nick);
        return {
          ...account,
          inSeat: Boolean(seat),
          online: Boolean(seat?.connected)
        };
      });
      socket.emit(ServerEvents.AdminAccountsListResult, { accounts });
    })
  );

  socket.on(ClientEvents.AdminAccountsForceLogout, (payload) =>
    run(socket, () => {
      const parsed = adminAccountsForceLogoutSchema.parse(payload);
      const store = requireAdminAccounts();
      takeAdminAccountAction();
      const audit = beginAdminAudit(store, {
        operator: String(socket.data.adminOperator ?? "admin"),
        targetPlayerId: parsed.playerId,
        action: "forceLogout",
        at: Date.now(),
        reason: parsed.reason
      });
      const exists = store.getByPlayerId(parsed.playerId);
      const success = Boolean(exists);
      const auditStored = completeAdminAudit(store, audit, success ? "success" : "failure");
      if (!success) throw new RoomError("ACCOUNT_NOT_FOUND", "账号不存在");
      removeAccountPresence(parsed.playerId, "ACCOUNT_FORCE_LOGOUT");
      socket.emit(ServerEvents.AdminActionResult, {
        action: "accounts:forceLogout",
        success: true,
        message: `已强制登出该账号${adminAuditSuffix(auditStored)}`
      });
    })
  );

  socket.on(ClientEvents.AdminAccountsSetStatus, (payload) =>
    run(socket, async () => {
      const parsed = adminAccountsSetStatusSchema.parse(payload);
      const store = requireAdminAccounts();
      takeAdminAccountAction();
      const audit = beginAdminAudit(store, {
        operator: String(socket.data.adminOperator ?? "admin"),
        targetPlayerId: parsed.playerId,
        action: "setStatus",
        at: Date.now(),
        reason: parsed.reason
      });
      const result = await store.setStatus(parsed.playerId, parsed.status);
      const auditStored = completeAdminAudit(store, audit, result.ok ? "success" : "failure");
      if (!result.ok) {
        if (result.reason === "store_unavailable") {
          throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
        }
        throw new RoomError("ACCOUNT_NOT_FOUND", "账号不存在");
      }
      if (parsed.status === "disabled") removeAccountPresence(parsed.playerId, "ACCOUNT_DISABLED");
      socket.emit(ServerEvents.AdminActionResult, {
        action: "accounts:setStatus",
        success: true,
        message: `${parsed.status === "disabled" ? "账号已停用" : "账号已恢复"}${adminAuditSuffix(auditStored)}`
      });
    })
  );

  socket.on(ClientEvents.AdminAccountsSoftDelete, (payload) =>
    run(socket, async () => {
      const parsed = adminAccountsSoftDeleteSchema.parse(payload);
      const store = requireAdminAccounts();
      takeAdminAccountAction();
      const audit = beginAdminAudit(store, {
        operator: String(socket.data.adminOperator ?? "admin"),
        targetPlayerId: parsed.playerId,
        action: "softDelete",
        at: Date.now(),
        reason: parsed.reason
      });
      const result = await store.softDelete(parsed.playerId);
      const auditStored = completeAdminAudit(store, audit, result.ok ? "success" : "failure");
      if (!result.ok) {
        if (result.reason === "store_unavailable") {
          throw new RoomError("ACCOUNT_STORE_UNAVAILABLE", "账号服务暂不可用，请联系管理员");
        }
        throw new RoomError("ACCOUNT_NOT_FOUND", "账号不存在");
      }
      removeAccountPresence(parsed.playerId, "ACCOUNT_DELETED");
      socket.emit(ServerEvents.AdminActionResult, {
        action: "accounts:softDelete",
        success: true,
        message: `账号已删除${adminAuditSuffix(auditStored)}`
      });
    })
  );

  socket.on(ClientEvents.AdminSeizeRoom, (payload) =>
    run(socket, () => {
      const parsed = adminSeizeRoomSchema.parse(payload);
      if (socket.data.role !== "admin") throw new RoomError("ADMIN_UNAUTHORIZED", "请先登录管理员账号");
      if (parsed.confirmedStateVersion !== room.stateVersion) {
        emitEnterConfirm();
        throw new RoomError("STALE_ADMIN_ACTION", "房间状态已变化，请确认最新状态后重试");
      }
      seizeRoomByAdmin();
    })
  );

  socket.on(ClientEvents.AdminKickPlayer, (payload) =>
    run(socket, () => {
      const parsed = adminKickPlayerSchema.parse(payload);
      if (socket.data.role !== "admin") throw new RoomError("ADMIN_UNAUTHORIZED", "请先登录管理员账号");
      const adminSeatId = socket.data.seatId as SeatId | undefined;
      if (parsed.stateVersion !== room.stateVersion) {
        throw new RoomError("STALE_ADMIN_ACTION", "房间状态已变化，请刷新后重试");
      }
      const target = findSeat(room, parsed.seatId);
      if (!target || !target.nick || target.kind !== "human" || (adminSeatId && target.id === adminSeatId)) {
        throw new RoomError("INVALID_TARGET", "无效的请出目标");
      }

      const beforePhase = room.phase;
      const targetSocket = target.socketId ? io.sockets.sockets.get(target.socketId) : undefined;

      // 非等待阶段先按"终止到等待大厅"清理运行态（沿用断线释放的同款语义），
      // 不写进度、不记失败；其余玩家保留座位但取消准备。
      const wasInGame = room.phase !== "waiting";
      if (wasInGame) {
        ctx.agentRuntime?.cancelDiscussion();
        clearAllTimers(room);
        resetRoundState(room);
        room.phase = "waiting";
        room.currentLevelIndex = null;
        room.currentChallenge = null;
        room.chat = [];
      }

      targetSocket?.emit(ServerEvents.PlayerKicked, { reason: "KICKED_BY_ADMIN" });
      sessions.revokeBySeat(target.id);
      if (targetSocket) {
        targetSocket.data.seatId = undefined;
        targetSocket.data.nick = undefined;
        targetSocket.data.playerId = undefined;
      }
      releaseSeat(room, target);
      if (wasInGame) room.ready = {};
      // 管理员是房主；目标不是房主时 releaseSeat 不会动 host，这里兜底保证不漂移。
      if (adminSeatId) room.host = adminSeatId;
      targetSocket?.disconnect(true);

      socket.emit(ServerEvents.AdminActionResult, {
        action: "kickPlayer",
        success: true,
        message: "已请出该玩家"
      });
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
      console.log(
        JSON.stringify({
          event: "admin:kick_player",
          targetSeatId: target.id,
          beforePhase,
          phase: room.phase,
          stateVersion: room.stateVersion
        })
      );
    })
  );

  socket.on(ClientEvents.AdminLogout, () => {
    // 仅撤销未入座的管理员登录态；已入座管理员走普通 player:leave。
    if (socket.data.role === "admin" && !socket.data.seatId) {
      socket.data.role = undefined;
      socket.data.adminOperator = undefined;
      socket.data.adminNick = undefined;
      socket.data.adminAvatar = undefined;
    }
  });

  socket.on("disconnect", () => {
    const seat = findSeat(room, socket.data.seatId as SeatId | undefined);
    if (!seat || seat.socketId !== socket.id) return;
    seat.connected = false;
    seat.socketId = undefined;
    seat.holdUntil = Date.now() + config.seatHoldMs;
    if (room.phase === "waiting") refreshHostStartTimer(io, room);
    setTimeout(() => {
      // The room may have been reset (room:reset, or all-disconnected
      // softResetRoom) while this timeout was pending —room.seats is then
      // a fresh generation of Seat objects and this `seat` is an orphaned
      // reference from the old one. Touching the current room with it would
      // act on the wrong seat (e.g. stealing host from whoever just took
      // this seat id), so bail out once the room has moved on.
      if (room.seats.find((candidate) => candidate.id === seat.id) !== seat) return;
      if (seat.connected || !seat.holdUntil || seat.holdUntil > Date.now()) return;
      if (room.phase === "levelSelect" || room.phase === "result") {
        returnToWaitingAndReleaseSeat(io, room, seat.id);
        return;
      }
      if (gameFlowPhases.has(room.phase)) {
        endGameAndResetRoom(io, room, agentRegistry, ctx.agentRuntime);
        return;
      }
      transferHostToConnectedSeat(room, seat.id);
      if (!seat.connected) {
        seat.nick = null;
        seat.avatar = null;
        seat.playerId = undefined;
        room.ready[seat.id] = false;
        sessions.revokeBySeat(seat.id);
      }
      if (!room.seats.some((candidate) => candidate.nick)) {
        clearAllTimers(room);
        agentRegistry.clear();
        sessions.revokeAll();
        softResetRoom(room);
      }
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    }, config.seatHoldMs + 10);
    emitStateToAll(io, room);
  });

  // 账号身份先恢复；即使座位令牌已失效，资料维护会话仍然有效。
  autoRestoreAccountFromAuth();
  autoReconnectFromAuth();
};
