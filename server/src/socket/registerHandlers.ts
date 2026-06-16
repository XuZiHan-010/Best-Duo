import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  ClientEvents,
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
import { enterResultAfterReveal, failByTimeout, revealAndScore } from "../game/reveal.js";
import { attachSeat, findEmptySeat, findReconnectSeat, releaseSeat, transferHostToConnectedSeat } from "../game/seating.js";
import {
  clearAllTimers,
  clearTurnTimers,
  startDiscussionTimer,
  startHintTimer,
  startTurnTimer
} from "../game/timers.js";
import type { ProgressStore } from "../persistence/progressStore.js";
import { emitRoomError, emitStateToAll } from "./emit.js";
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
  try {
    await store.save(progress);
  } catch (error) {
    console.warn(JSON.stringify({ event: "progress:save_failed", error: String(error) }));
  }
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

const afterRevealIfNeeded = async (ctx: HandlerContext) => {
  if (totalPlacedCards(ctx.room) < 12) return;
  clearAllTimers(ctx.room);
  revealAndScore(ctx.room);
  if (ctx.room.revealResult?.pass && ctx.room.currentLevelIndex !== null) {
    ctx.room.progress.clearedLevels = [...new Set([...ctx.room.progress.clearedLevels, ctx.room.currentLevelIndex])].sort(
      (a, b) => a - b
    );
    await saveProgress(ctx.progressStore, ctx.room.progress);
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

const run = (socket: Socket, fn: () => void | Promise<void>) => {
  void Promise.resolve()
    .then(fn)
    .catch((error) => {
      emitRoomError(socket, "bad-request", error instanceof Error ? error.message : String(error));
    });
};

export const registerHandlers = (ctx: HandlerContext) => {
  const { io, socket, room, levels, progressStore } = ctx;

  const autoReconnectFromQuery = () => {
    const rawNick = socket.handshake.query.nick;
    const nick = Array.isArray(rawNick) ? rawNick[0] : rawNick;
    if (!nick) return;

    const parsed = playerJoinSchema.safeParse({ nick });
    if (!parsed.success) return;

    const seat = findReconnectSeat(room, parsed.data.nick);
    if (!seat) return;

    attachSeat(seat, socket.id, parsed.data.nick);
    socket.data.seatId = seat.id;
    socket.data.nick = parsed.data.nick;
    emitStateToAll(io, room);
  };

  socket.on(ClientEvents.PlayerJoin, (payload) =>
    run(socket, () => {
      const { nick } = playerJoinSchema.parse(payload);
      const seat = findReconnectSeat(room, nick) ?? findEmptySeat(room);
      if (!seat) throw new Error("房间已满");
      attachSeat(seat, socket.id, nick);
      socket.data.seatId = seat.id;
      socket.data.nick = nick;
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.PlayerLeave, () =>
    run(socket, () => {
      const seat = findSeat(room, requireSeatId(socket));
      if (!seat) return;
      releaseSeat(room, seat);
      socket.data.seatId = undefined;
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.PlayerReady, () =>
    run(socket, () => {
      const seatId = requireSeatId(socket);
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以准备");
      room.ready[seatId] = !room.ready[seatId];
      if (room.ready[seatId] && !room.host) room.host = seatId;
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.SettingsUpdate, (payload) =>
    run(socket, async () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以修改设置");
      if (room.phase !== "waiting") throw new Error("只有等待阶段可以修改设置");
      const patch = settingsUpdateSchema.parse(payload);
      room.settings = { ...room.settings, ...patch, capacity: 2 };
      room.capacity = room.settings.capacity;
      room.progress.settings = room.settings;
      await saveProgress(progressStore, room.progress);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.GameStart, () =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以开始游戏");
      if (!allSeatsOccupied(room) || !allReady(room)) throw new Error("需要所有玩家就座并准备");
      enterLevelSelect(room);
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.HostSelectLevel, (payload) =>
    run(socket, () => {
      if (!isHost(room, requireSeatId(socket))) throw new Error("只有房主可以选关");
      const { levelIndex } = hostSelectLevelSchema.parse(payload);
      const level = levels.find((candidate) => candidate.levelIndex === levelIndex);
      if (!level) throw new Error("关卡不存在");
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

  socket.on(ClientEvents.CardPlace, (payload) =>
    run(socket, () => {
      const seatId = requireSeatId(socket);
      const parsed = cardPlaceSchema.parse(payload);
      applyPlacement(room, seatId, parsed);
      clearTurnTimers(room);
      startHintTimer(room, () => {
        run(socket, async () => {
          applyHintDecision(room, room.pendingHint?.seatId ?? seatId, "no");
          clearTurnTimers(room);
          await afterRevealIfNeeded(ctx);
          await continueTurnOrAgentHandoff(ctx);
          emitStateToAll(io, room);
        });
      });
      emitStateToAll(io, room);
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
      emitStateToAll(io, room);
    })
  );

  socket.on(ClientEvents.RoomReset, () =>
    run(socket, () => {
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
    void continueTurnOrAgentHandoff(ctx).then(() => emitStateToAll(io, room));
    setTimeout(() => {
      if (seat.connected || !seat.holdUntil || seat.holdUntil > Date.now()) return;
      transferHostToConnectedSeat(room, seat.id);
      if (!seat.connected) {
        seat.nick = null;
        room.ready[seat.id] = false;
      }
      if (!room.seats.some((candidate) => candidate.nick)) {
        clearAllTimers(room);
        softResetRoom(room);
      }
      emitStateToAll(io, room);
    }, config.seatHoldMs + 10);
    emitStateToAll(io, room);
  });

  autoReconnectFromQuery();
};
