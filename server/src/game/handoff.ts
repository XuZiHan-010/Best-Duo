import type { CardPlacePayload, GameRoom, HintDecidePayload, SeatId } from "@take-time/shared";
import { applyHintDecision, applyPlacement } from "./actions.js";
import { buildAgentRoomView, type AgentRegistry } from "../agent/agentDriver.js";

interface HandoffOptions {
  afterRevealIfNeeded: () => Promise<void>;
  startTurnTimer: () => void;
  agentRegistry?: AgentRegistry;
}

const agentForSeat = (room: GameRoom, registry: AgentRegistry | undefined, seatId: SeatId | null | undefined) => {
  if (!registry || !seatId) return null;
  const seat = room.seats.find((candidate) => candidate.id === seatId);
  if (seat?.kind !== "agent" || !seat.agentId) return null;
  const agent = registry.get(seat.agentId);
  return agent ? { agent, seatId } : null;
};

const fallbackPlacement = (room: GameRoom, seatId: SeatId): CardPlacePayload => {
  const card = room.hands[seatId]?.[0];
  if (!card) throw new Error("Agent has no card to place");

  const segmentLoads = room.placements.map((segment, index) => ({ index, count: segment.length }));
  segmentLoads.sort((left, right) => left.count - right.count || left.index - right.index);
  return { cardId: card.id, segment: segmentLoads[0]?.index ?? 0 };
};

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

export const continueTurnOrHandoff = async (room: GameRoom, options: HandoffOptions) => {
  await options.afterRevealIfNeeded();

  while (room.phase === "placing") {
    if (room.pendingHint) {
      const seatId = room.pendingHint.seatId;
      const decision = await decideHintSafely(room, seatId, options);
      if (!decision) return;
      applyHintDecision(room, seatId, decision);
      await options.afterRevealIfNeeded();
      continue;
    }

    if (!room.turn || room.turn === "race") {
      options.startTurnTimer();
      return;
    }

    const seatId = room.turn;
    const decision = await decidePlacementSafely(room, seatId, options);
    if (!decision) {
      options.startTurnTimer();
      return;
    }

    try {
      applyPlacement(room, seatId, decision);
    } catch (error) {
      console.warn(JSON.stringify({ event: "agent:placement_invalid", seatId, error: String(error) }));
      applyPlacement(room, seatId, fallbackPlacement(room, seatId));
    }
    await options.afterRevealIfNeeded();
  }
};