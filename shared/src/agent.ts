import type { CardPlacePayload, HintDecidePayload } from "./events.js";
import type { PublicHandCard, PublicRoomState, SeatId } from "./state.js";

export interface AgentRoomView {
  seatId: SeatId;
  room: PublicRoomState;
  hand: PublicHandCard[];
}

export interface PlayerAgent {
  decidePlacement(view: AgentRoomView): Promise<CardPlacePayload>;
  decideHint(view: AgentRoomView): Promise<HintDecidePayload["decision"]>;
  decideDiscussion(view: AgentRoomView): Promise<{ message: string } | null>;
}
