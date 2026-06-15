import type { GameRoom, Seat, SeatId } from "@take-time/shared";
import { applyHintDecision, applyPlacement } from "./actions.js";
import { findSeat } from "./room.js";
import { clearTurnTimers } from "./timers.js";

interface HandoffOptions {
  afterRevealIfNeeded: () => Promise<void>;
  startTurnTimer: () => void;
}

const randomInt = (maxExclusive: number) => Math.floor(Math.random() * maxExclusive);

const isDisconnectedOccupiedSeat = (seat: Seat | undefined) => Boolean(seat?.nick && !seat.connected);

const seatForRandomPlacement = (room: GameRoom): SeatId | null => {
  if (room.turn && room.turn !== "race") {
    const seat = findSeat(room, room.turn);
    return isDisconnectedOccupiedSeat(seat) ? room.turn : null;
  }

  if (room.turn !== "race") return null;

  const connectedSeatExists = room.seats.some((seat) => seat.nick && seat.connected);
  if (connectedSeatExists) return null;

  return room.seats.find((seat) => isDisconnectedOccupiedSeat(seat))?.id ?? null;
};

const applyRandomPlacementForSeat = (room: GameRoom, seatId: SeatId) => {
  const hand = room.hands[seatId] ?? [];
  if (hand.length === 0) throw new Error("No cards available for disconnected player handoff");
  const card = hand[randomInt(hand.length)];
  applyPlacement(room, seatId, {
    cardId: card.id,
    segment: randomInt(6)
  });
};

export const continueTurnOrHandoff = async (room: GameRoom, options: HandoffOptions) => {
  let handoffSteps = 0;

  while (room.phase === "placing" && handoffSteps < 24) {
    if (room.pendingHint) {
      const hintSeat = findSeat(room, room.pendingHint.seatId);
      if (!isDisconnectedOccupiedSeat(hintSeat)) return;

      clearTurnTimers(room);
      applyHintDecision(room, room.pendingHint.seatId, "no");
      await options.afterRevealIfNeeded();
      handoffSteps += 1;
      continue;
    }

    const seatId = seatForRandomPlacement(room);
    if (!seatId) {
      options.startTurnTimer();
      return;
    }

    clearTurnTimers(room);
    applyRandomPlacementForSeat(room, seatId);
    applyHintDecision(room, seatId, "no");
    await options.afterRevealIfNeeded();
    handoffSteps += 1;
  }

  if (room.phase === "placing" && !room.pendingHint) {
    options.startTurnTimer();
  }
};
