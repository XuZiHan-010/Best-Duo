import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  ClientEvents,
  ServerEvents,
  type Challenge,
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
import { closeLevelRun } from "../game/identity.js";
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
import {
  clearAllTimers,
  clearHostStartTimer,
  clearLevelSelectTimer,
  clearTurnTimers,
  startHostStartTimer,
  startLevelSelectTimer,
  startDiscussionTimer,
  startHintTimer,
  startTurnTimer
} from "../game/timers.js";
import type { ProgressStore } from "../persistence/progressStore.js";
import { emitRoomError, emitStateToAll, emitStateToSocket } from "./emit.js";
import {
  cardPlaceSchema,
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
  }
};

const clearSocketBindingForSeat = (io: Server, socketId: string | undefined, notifySessionEnded = false) => {
  if (!socketId) return;
  const connectedSocket = io.sockets.sockets.get(socketId);
  if (!connectedSocket) return;
  if (notifySessionEnded) connectedSocket.emit(ServerEvents.GameEnded);
  connectedSocket.data.seatId = undefined;
  connectedSocket.data.nick = undefined;
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

// 返回是否真的进入了 placing：讨论收口 await 期间房间可能已经换了
// attempt（返回选关 / 重选关卡），过期请求不得推进新一轮讨论（ACR-01）。
const beginPlacementWithTimers = async (ctx: HandlerContext): Promise<boolean> => {
  if (ctx.room.phase !== "discussion") throw new Error("Cannot begin placement now");
  const attemptToken = ctx.room.identity.attemptId;
  // 讨论收口：取消未完成发言，每个 Agent 独立锁定自己的 SeatStrategy。
  await ctx.agentRuntime?.finalizeDiscussion(ctx.room);
  if (ctx.room.phase !== "discussion" || ctx.room.identity.attemptId !== attemptToken) {
    console.warn(JSON.stringify({ event: "placement:stale_begin_discarded", attemptId: attemptToken }));
    return false;
  }
  clearAllTimers(ctx.room);
  beginPlacement(ctx.room);
  ctx.agentRuntime?.recordPhaseChange(ctx.room);
  startTurnTimer(ctx.room, () => handleTimerFailure(ctx));
  return true;
};

const continueTurnOrAgentHandoff = (ctx: HandlerContext) =>
  continueTurnOrHandoff(ctx.room, {
    afterRevealIfNeeded: () => afterRevealIfNeeded(ctx),
    startTurnTimer: () => startTurnTimer(ctx.room, () => handleTimerFailure(ctx)),
    agentRegistry: ctx.agentRegistry,
    onPlacement: (seatId, segment, placed) => ctx.agentRuntime?.recordPlacement(ctx.room, seatId, segment, placed),
    onHintDecision: (seatId, decision, hint) => ctx.agentRuntime?.recordHintDecision(ctx.room, seatId, decision, hint)
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
        await continueTurnOrAgentHandoff(ctx);
        emitStateToAll(ctx.io, ctx.room);
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
          await continueTurnOrAgentHandoff(ctx);
          emitStateToAll(ctx.io, ctx.room);
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
        await continueTurnOrAgentHandoff(ctx);
        emitStateToAll(ctx.io, ctx.room);
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

  // 首次入座：附着 + 签发新会话 + 私发凭证。
  const attachWithSession = (seat: (typeof room.seats)[number], nick: string, avatar?: string | null) => {
    attachSeat(room, seat, socket.id, nick, avatar);
    socket.data.seatId = seat.id;
    socket.data.nick = seat.nick;
    const cred = sessions.issue(seat.id);
    socket.emit(ServerEvents.PlayerSession, { ...cred, seatId: seat.id });
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  // 会话重连/接管：先验证、附着并轮换成功，最后才断开旧 socket。
  const takeOverSeat = (seat: (typeof room.seats)[number], playerId: string, avatar?: string | null) => {
    const staleSocketId = seat.socketId;
    attachSeat(room, seat, socket.id, seat.nick ?? "", avatar ?? seat.avatar);
    socket.data.seatId = seat.id;
    socket.data.nick = seat.nick;
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
    const seatId = sessions.verify(playerId, reconnectToken);
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
  };

  socket.on(ClientEvents.PlayerJoin, (payload) =>
    run(socket, () => {
      const { nick, avatar, password, session } = playerJoinSchema.parse(payload);
      assertRoomPassword(password);

      // 携带会话凭证 = 重连/接管既有座位；昵称不再承担身份认证。
      if (session) {
        const seat = resolveSessionSeat(session.playerId, session.reconnectToken);
        if (!seat) throw new RoomError("INVALID_PLAYER_SESSION", "玩家会话无效或已撤销，请重新加入");
        takeOverSeat(seat, session.playerId, avatar);
        return;
      }

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
            await continueTurnOrAgentHandoff(ctx);
            emitStateToAll(io, room, "hint:timeout");
          });
        });
      } else {
        await continueTurnOrAgentHandoff(ctx);
      }
      emitStateToAll(io, room, "card:place");
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
      await continueTurnOrAgentHandoff(ctx);
      emitStateToAll(io, room);
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
      endGameAndResetRoom(io, room, agentRegistry, ctx.agentRuntime);
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

  autoReconnectFromAuth();
};
