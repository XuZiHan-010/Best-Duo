import type { GameRoom, SeatId } from "@take-time/shared";
import { privateHandForSeat, publicRoomState } from "../game/visibility.js";
import type { PlayerAgent } from "./PlayerAgent.js";

export const buildAgentRoomView = (room: GameRoom, seatId: SeatId) => ({
  seatId,
  room: publicRoomState(room),
  hand: privateHandForSeat(room, seatId)
});

export interface AgentRegistry {
  get(agentId: string): PlayerAgent | undefined;
}

export const hasAgentForTurn = (room: GameRoom, registry: AgentRegistry): boolean => {
  if (!room.turn || room.turn === "race") return false;
  const seat = room.seats.find((candidate) => candidate.id === room.turn);
  return Boolean(seat?.kind === "agent" && seat.agentId && registry.get(seat.agentId));
};
