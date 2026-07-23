import type { CardPlacePayload, GameRoom, HintDecidePayload, PlacedCard, SeatId } from "@take-time/shared";
import { applyHintDecision, applyPlacement, GameActionError } from "./actions.js";
import { buildAgentRoomView, type AgentRegistry } from "../agent/agentDriver.js";
import { decideSafePlacement } from "../agent/safePolicy.js";
import { buildTurnView } from "../agent/views.js";

export interface HandoffOptions {
  afterRevealIfNeeded: () => Promise<void>;
  startTurnTimer: () => void;
  agentRegistry?: AgentRegistry;
  // Agent 路径的动作事件回调：由调用方写入 agent memory 的公开 observation。
  onPlacement?: (seatId: SeatId, segment: number, placed: PlacedCard) => void;
  onHintDecision?: (
    seatId: SeatId,
    decision: HintDecidePayload["decision"],
    hint: { cardId: string; segment: number }
  ) => void;
  // race 获胜后取消其他座位的模型请求，但保留获胜者的 hint 意图缓存。
  onRaceWinner?: (seatId: SeatId) => void;
  // 生产使用短随机延迟模拟抢先手；测试可注入确定性延迟。
  raceDelay?: (seatId: SeatId, signal: AbortSignal) => Promise<void>;
}

interface HandoffRunState {
  active: Promise<void> | null;
  rerunRequested: boolean;
  requestedKey: string;
  options: HandoffOptions;
}

const handoffRuns = new WeakMap<GameRoom, HandoffRunState>();

const defaultRaceDelay = (_seatId: SeatId, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("race delay cancelled"));
    };
    const timer = setTimeout(finish, 50 + Math.floor(Math.random() * 201));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });

const handoffStateKey = (room: GameRoom) =>
  [
    room.identity.attemptId,
    room.phase,
    room.phaseVersion,
    room.turnVersion,
    room.turn,
    room.pendingHint?.cardId ?? ""
  ].join(":");

const agentForSeat = (room: GameRoom, registry: AgentRegistry | undefined, seatId: SeatId | null | undefined) => {
  if (!registry || !seatId) return null;
  const seat = room.seats.find((candidate) => candidate.id === seatId);
  if (seat?.kind !== "agent" || !seat.agentId) return null;
  const agent = registry.get(seat.agentId);
  return agent ? { agent, seatId } : null;
};

// 最后一道兜底也必须经安全视图进入同一个规则安全策略：
// 直接读 room.hands 会绕过可见性遮蔽，并在生产里留下第二套会漂移的策略。
const fallbackPlacement = (room: GameRoom, seatId: SeatId): CardPlacePayload =>
  decideSafePlacement(buildTurnView(room, seatId));

const decidePlacementSafely = async (room: GameRoom, seatId: SeatId, options: HandoffOptions) => {
  const agentEntry = agentForSeat(room, options.agentRegistry, seatId);
  if (!agentEntry) return null;

  const phaseVersion = room.phaseVersion;
  const turnVersion = room.turnVersion;
  try {
    const decision = await agentEntry.agent.decidePlacement(buildAgentRoomView(room, seatId));
    if (room.phaseVersion !== phaseVersion || room.turnVersion !== turnVersion) return null;
    return decision;
  } catch (error) {
    console.warn(JSON.stringify({ event: "agent:placement_fallback", seatId, error: String(error) }));
    if (room.phaseVersion !== phaseVersion || room.turnVersion !== turnVersion) return null;
    return fallbackPlacement(room, seatId);
  }
};

const decideHintSafely = async (room: GameRoom, seatId: SeatId, options: HandoffOptions): Promise<HintDecidePayload["decision"] | null> => {
  const agentEntry = agentForSeat(room, options.agentRegistry, seatId);
  if (!agentEntry) return null;

  const phaseVersion = room.phaseVersion;
  const turnVersion = room.turnVersion;
  try {
    const decision = await agentEntry.agent.decideHint(buildAgentRoomView(room, seatId));
    if (room.phaseVersion !== phaseVersion || room.turnVersion !== turnVersion) return null;
    return decision === "yes" ? "yes" : "no";
  } catch (error) {
    console.warn(JSON.stringify({ event: "agent:hint_fallback", seatId, error: String(error) }));
    if (room.phaseVersion !== phaseVersion || room.turnVersion !== turnVersion) return null;
    return "no";
  }
};

const applyAgentPlacement = (
  room: GameRoom,
  seatId: SeatId,
  decision: CardPlacePayload,
  options: HandoffOptions
): boolean => {
  try {
    const placed = applyPlacement(room, seatId, decision);
    options.onPlacement?.(seatId, decision.segment, placed);
    return true;
  } catch (error) {
    if (error instanceof GameActionError && error.code === "STALE_TURN") {
      console.log(JSON.stringify({ event: "agent:placement_stale", seatId, message: error.message }));
      return false;
    }
    if (!(error instanceof GameActionError) || error.code !== "INVALID_DECISION") {
      console.error(JSON.stringify({ event: "agent:placement_invariant_failed", seatId, error: String(error) }));
      return false;
    }

    console.warn(JSON.stringify({ event: "agent:placement_invalid", seatId, error: String(error) }));
    try {
      const fallback = fallbackPlacement(room, seatId);
      const placed = applyPlacement(room, seatId, fallback);
      options.onPlacement?.(seatId, fallback.segment, placed);
      return true;
    } catch (fallbackError) {
      console.error(
        JSON.stringify({ event: "agent:placement_fallback_failed", seatId, error: String(fallbackError) })
      );
      return false;
    }
  }
};

const raceAgentSeatIds = (room: GameRoom, registry: AgentRegistry | undefined): SeatId[] =>
  room.seats
    .filter((seat) => seat.kind === "agent" && Boolean(seat.agentId && registry?.get(seat.agentId)))
    .map((seat) => seat.id);

const runAgentRace = async (room: GameRoom, options: HandoffOptions): Promise<boolean> => {
  const contenders = raceAgentSeatIds(room, options.agentRegistry);
  if (contenders.length === 0) return false;

  options.startTurnTimer();
  const delay = options.raceDelay ?? defaultRaceDelay;
  const raceToken = {
    attemptId: room.identity.attemptId,
    phaseVersion: room.phaseVersion,
    turnVersion: room.turnVersion
  };
  const delayController = new AbortController();
  const raceIsCurrent = () =>
    room.identity.attemptId === raceToken.attemptId &&
    room.phase === "placing" &&
    room.phaseVersion === raceToken.phaseVersion &&
    room.turnVersion === raceToken.turnVersion &&
    room.turn === "race" &&
    !room.pendingHint;
  const attempts = contenders.map(async (seatId) => {
    await delay(seatId, delayController.signal);
    // 赢家或真人可能在本座位的随机延迟结束前已经落子。此时该座位尚未
    // 注册模型请求，不能依赖 TurnCoordinator.cancelOtherSeats；必须在发起
    // Provider 调用前复核最初的 race token。
    if (delayController.signal.aborted || !raceIsCurrent()) throw new Error("race decision cancelled");
    const decision = await decidePlacementSafely(room, seatId, options);
    if (!decision || !raceIsCurrent()) throw new Error("race decision cancelled");
    return { seatId, decision };
  });

  let winner: { seatId: SeatId; decision: CardPlacePayload };
  try {
    winner = await Promise.any(attempts);
  } catch {
    delayController.abort();
    return false;
  }

  if (!applyAgentPlacement(room, winner.seatId, winner.decision, options)) {
    delayController.abort();
    return false;
  }
  // 先阻止仍在随机延迟中的输家启动新请求，再取消已经在途的模型调用。
  delayController.abort();
  options.onRaceWinner?.(winner.seatId);
  return true;
};

const runHandoffLoop = async (room: GameRoom, options: HandoffOptions) => {
  await options.afterRevealIfNeeded();

  while (room.phase === "placing") {
    if (room.pendingHint) {
      const seatId = room.pendingHint.seatId;
      const hint = { cardId: room.pendingHint.cardId, segment: room.pendingHint.segment };
      const decision = await decideHintSafely(room, seatId, options);
      if (!decision) return;
      applyHintDecision(room, seatId, decision);
      options.onHintDecision?.(seatId, decision, hint);
      await options.afterRevealIfNeeded();
      continue;
    }

    if (!room.turn) {
      options.startTurnTimer();
      return;
    }

    if (room.turn === "race") {
      const placed = await runAgentRace(room, options);
      if (!placed) {
        if (room.phase === "placing" && !room.pendingHint) options.startTurnTimer();
        return;
      }
      await options.afterRevealIfNeeded();
      continue;
    }

    const seatId = room.turn;
    // 真人和 Agent 的顺序回合都先挂上同一套公共倒计时；Agent 的模型
    // deadline 与可见节奏都必须落在这个窗口内。
    options.startTurnTimer();
    const decision = await decidePlacementSafely(room, seatId, options);
    if (!decision) {
      return;
    }

    if (!applyAgentPlacement(room, seatId, decision, options)) return;
    await options.afterRevealIfNeeded();
  }
};

// 每个房间只允许一个 handoff 循环活动。运行期间的新触发只设置续跑标记，
// 当前循环在安全点结束后消费，避免重复模型调用、重复计时器和并发落子。
export const continueTurnOrHandoff = (room: GameRoom, options: HandoffOptions): Promise<void> => {
  const requestedKey = handoffStateKey(room);
  let state = handoffRuns.get(room);
  if (!state) {
    state = { active: null, rerunRequested: false, requestedKey, options };
    handoffRuns.set(room, state);
  }
  state.options = options;
  if (state.active) {
    if (state.requestedKey !== requestedKey) {
      state.requestedKey = requestedKey;
      state.rerunRequested = true;
    }
    return state.active;
  }
  state.requestedKey = requestedKey;
  state.rerunRequested = true;

  state.active = (async () => {
    try {
      do {
        state!.rerunRequested = false;
        await runHandoffLoop(room, state!.options);
      } while (state!.rerunRequested);
    } finally {
      state!.active = null;
      if (!state!.rerunRequested) handoffRuns.delete(room);
    }
  })();
  return state.active;
};
