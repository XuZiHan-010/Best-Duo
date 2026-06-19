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
import { applyHintDecision, applyPlacement } from "../game/actions.js";
import { continueTurnOrHandoff } from "../game/handoff.js";
import { beginPlacement, enterDiscussion, enterLevelSelect } from "../game/phases.js";
import {
  allReady,
  allSeatsOccupied,
  findSeat,
  isHost,
  resetRoundState,
  softResetRoom,
  totalPlacedCards
} from "../game/room.js";
import { enterResultAfterReveal, failByPlayerLeft, failByTimeout, revealAndScore } from "../game/reveal.js";
import { attachSeat, findEmptySeat, findReconnectSeat, releaseSeat, transferHostToConnectedSeat } from "../game/seating.js";
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
  playerJoinSchema,
  settingsUpdateSchema
} from "../validation/schemas.js";

interface HandlerContext {
  io: Server;
  socket: Socket;
  room: GameRoom;
  levels: Challenge[];
  progressStore: ProgressStore;
}

const saveProgress = async (store: ProgressStore, progress: ProgressState) => {
  await store.save(progress);
};

const requireSeatId = (socket: Socket): SeatId => {
  const seatId = socket.data.seatId as SeatId | undefined;
  if (!seatId) throw new Error("请先加入房间");
  return seatId;
};

const handleTimerFailure = (io: Server, room: GameRoom) => {
  clearAllTimers(room);
  failByTimeout(room);
  emitStateToAll(io, room);
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

const endGameAndResetRoom = (io: Server, room: GameRoom) => {
  clearAllTimers(room);
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
  }
  refreshHostStartTimer(io, room);
  emitStateToAll(io, room);
};

const allConnectedPlayersReady = (room: GameRoom) =>
  room.phase === "waiting" &&
  room.seats.every((seat) => Boolean(seat.nick && seat.connected && room.ready[seat.id]));

const pickRandomReadyHost = (room: GameRoom, excludedSeatId: SeatId) => {
  const candidates = room.seats.filter(
    (seat) => seat.id !== excludedSeatId && seat.nick && seat.connected && room.ready[seat.id]
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

const beginPlacementWithTimers = (ctx: HandlerContext) => {
  clearAllTimers(ctx.room);
  beginPlacement(ctx.room);
  startTurnTimer(ctx.room, () => handleTimerFailure(ctx.io, ctx.room));
};

const continueTurnOrAgentHandoff = (ctx: HandlerContext) =>
  continueTurnOrHandoff(ctx.room, {
    afterRevealIfNeeded: () => afterRevealIfNeeded(ctx),
    startTurnTimer: () => startTurnTimer(ctx.room, () => handleTimerFailure(ctx.io, ctx.room))
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
  startDiscussionTimer(ctx.room, () => {
    void Promise.resolve()
      .then(async () => {
        beginPlacementWithTimers(ctx);
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
          beginPlacementWithTimers(ctx);
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
        applyHintDecision(ctx.room, ctx.room.pendingHint?.seatId ?? requireSeatId(ctx.socket), "no");
        clearTurnTimers(ctx.room);
        await afterRevealIfNeeded(ctx);
        await continueTurnOrAgentHandoff(ctx);
        emitStateToAll(ctx.io, ctx.room);
      });
    });
    return;
  }

  startTurnTimer(ctx.room, () => handleTimerFailure(ctx.io, ctx.room));
};

const run = (socket: Socket, fn: () => void | Promise<void>) => {
  void Promise.resolve()
    .then(fn)
    .catch((error) => {
      emitRoomError(socket, "bad-request", error instanceof Error ? error.message : String(error));
    });
};

const assertRoomPassword = (password: string) => {
  if (password !== config.roomPassword) throw new Error("房间密码错误");
};

export const registerHandlers = (ctx: HandlerContext) => {
  const { io, socket, room, levels, progressStore } = ctx;

  const autoReconnectFromQuery = () => {
    const rawNick = socket.handshake.query.nick;
    const rawPassword = socket.handshake.query.password;
    const nick = Array.isArray(rawNick) ? rawNick[0] : rawNick;
    const password = Array.isArray(rawPassword) ? rawPassword[0] : rawPassword;
    if (!nick || !password) return;

    const parsed = playerJoinSchema.safeParse({ nick, password });
    if (!parsed.success) return;
    try {
      assertRoomPassword(parsed.data.password);
    } catch {
      return;
    }

    const seat = findReconnectSeat(room, parsed.data.nick);
    if (!seat) return;

    attachSeat(room, seat, socket.id, parsed.data.nick, parsed.data.avatar);
    socket.data.seatId = seat.id;
    socket.data.nick = parsed.data.nick;
    resumeTimersAfterReconnect(ctx);
    refreshHostStartTimer(io, room);
    emitStateToAll(io, room);
  };

  socket.on(ClientEvents.PlayerJoin, (payload) =>
    run(socket, () => {
      const { nick, avatar, password } = playerJoinSchema.parse(payload);
      assertRoomPassword(password);
      const connectedSameNick = room.seats.find((seat) => seat.nick === nick && seat.connected);
      if (connectedSameNick) throw new Error("该昵称已在房间中");

      const reconnectSeat = findReconnectSeat(room, nick);
      if (!reconnectSeat && room.phase !== "waiting") throw new Error("对局进行中，不能加入新座位");

      const seat = reconnectSeat ?? findEmptySeat(room);
      if (!seat) throw new Error("房间已满");
      attachSeat(room, seat, socket.id, nick, avatar);
      socket.data.seatId = seat.id;
      socket.data.nick = nick;
      if (reconnectSeat) resumeTimersAfterReconnect(ctx);
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.PlayerLeave, () =>
    run(socket, () => {
      const seat = findSeat(room, requireSeatId(socket));
      if (!seat) return;
      if (room.phase === "discussion" || room.phase === "placing") {
        clearAllTimers(room);
        failByPlayerLeft(room);
      }
      releaseSeat(room, seat);
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

  socket.on(ClientEvents.SettingsUpdate, (payload) =>
    run(socket, async () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以修改设置");
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以修改设置");
      const patch = settingsUpdateSchema.parse(payload);
      const nextSettings = { ...room.settings, ...patch, capacity: 2 as const };
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
      if (!allSeatsOccupied(room) || !allReady(room)) throw new Error("需要所有玩家就座并准备");
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
      // 顺序解锁：第 1 关始终开放；其余关卡需上一关已通关才可选。
      if (!isLevelUnlocked(room.progress, levelIndex)) throw new Error("该关卡尚未解锁");
      clearLevelSelectTimer(room);
      startDiscussionWithTimer(ctx, level);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameBeginPlacement, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以提前开始出牌");
      beginPlacementWithTimers(ctx);
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
      room.chat.push({
        id: randomUUID(),
        senderSeatId: seatId,
        kind: "human",
        nick: seat?.nick ?? seatId,
        text,
        ts: Date.now()
      });
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
      applyPlacement(room, seatId, parsed);
      clearTurnTimers(room);
      if (room.pendingHint) {
        startHintTimer(room, () => {
          run(socket, async () => {
            applyHintDecision(room, room.pendingHint?.seatId ?? seatId, "no");
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
      applyHintDecision(room, seatId, decision);
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
      endGameAndResetRoom(io, room);
    })
  );

  socket.on(ClientEvents.HostBackToLevelSelect, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以返回选关");
      if (!["discussion", "placing", "reveal", "result"].includes(room.phase)) throw new Error("当前阶段无法返回选关");
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
      clearAllTimers(room);
      softResetRoom(room);
      emitStateToAll(io, room);
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
      // softResetRoom) while this timeout was pending — room.seats is then
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
        endGameAndResetRoom(io, room);
        return;
      }
      transferHostToConnectedSeat(room, seat.id);
      if (!seat.connected) {
        seat.nick = null;
        seat.avatar = null;
        room.ready[seat.id] = false;
      }
      if (!room.seats.some((candidate) => candidate.nick)) {
        clearAllTimers(room);
        softResetRoom(room);
      }
      refreshHostStartTimer(io, room);
      emitStateToAll(io, room);
    }, config.seatHoldMs + 10);
    emitStateToAll(io, room);
  });

  autoReconnectFromQuery();
};
