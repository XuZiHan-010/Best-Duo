import type { CardPlacePayload, GameRoom, HintDecidePayload, PlacedCard, SeatId } from "@take-time/shared";
import { config } from "../config.js";
import { revealRemainingBlindCardsIfNeeded } from "./deal.js";
import { totalPlacedCards } from "./room.js";
import { nextSeatAfter } from "./turnOrder.js";

export type GameActionErrorCode = "STALE_TURN" | "INVALID_DECISION";

export class GameActionError extends Error {
  constructor(
    readonly code: GameActionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GameActionError";
  }
}

const continueAfterPlacement = (room: GameRoom, previousSeat: SeatId) => {
  if (totalPlacedCards(room) >= 12) {
    room.turn = null;
  } else {
    room.turn = nextSeatAfter(room, previousSeat);
  }
  room.turnVersion += 1;
};

export const applyPlacement = (room: GameRoom, seatId: SeatId, payload: CardPlacePayload): PlacedCard => {
  if (room.phase !== "placing") throw new GameActionError("STALE_TURN", "现在不能出牌");
  if (room.pendingHint) throw new GameActionError("STALE_TURN", "请先处理提示标记窗口");
  if (room.turn !== "race" && room.turn !== seatId) throw new GameActionError("STALE_TURN", "还没轮到你出牌");
  if (!Number.isInteger(payload.segment) || payload.segment < 0 || payload.segment > 5) {
    throw new GameActionError("INVALID_DECISION", "区段不合法");
  }

  const hand = room.hands[seatId] ?? [];
  const cardIndex = hand.findIndex((card) => card.id === payload.cardId);
  if (cardIndex < 0) throw new GameActionError("INVALID_DECISION", "这张牌不在你的手牌中");

  const [card] = hand.splice(cardIndex, 1);
  const placed: PlacedCard = {
    id: card.id,
    owner: seatId,
    value: card.value,
    color: card.color,
    revealed: false,
    placedAt: Date.now(),
    playOrder: totalPlacedCards(room) + 1
  };

  room.placements[payload.segment].push(placed);
  room.playedCount[seatId] = (room.playedCount[seatId] ?? 0) + 1;
  if (room.hintMarkers.used >= room.hintMarkers.total) {
    // 没有提示窗口时不存在“先决定翻不翻”的步骤，落子后直接结算盲牌翻开。
    revealRemainingBlindCardsIfNeeded(room);
    room.pendingHint = null;
    continueAfterPlacement(room, seatId);
    return placed;
  }

  room.pendingHint = {
    seatId,
    cardId: placed.id,
    segment: payload.segment,
    deadline: Date.now() + (config.hintWindowOverrideMs ?? room.settings.thinkSeconds * 1_000)
  };
  room.turn = null;
  room.turnVersion += 1;
  return placed;
};

export const applyHintDecision = (room: GameRoom, seatId: SeatId, decision: HintDecidePayload["decision"]) => {
  if (room.phase !== "placing") throw new GameActionError("STALE_TURN", "现在不能处理提示标记");
  if (!room.pendingHint || room.pendingHint.seatId !== seatId) {
    throw new GameActionError("STALE_TURN", "没有属于你的提示窗口");
  }

  const placed = room.placements[room.pendingHint.segment].find((card) => card.id === room.pendingHint?.cardId);
  if (placed && decision === "yes" && room.hintMarkers.used < room.hintMarkers.total) {
    placed.revealed = true;
    room.hintMarkers.used += 1;
  }

  const previousSeat = room.pendingHint.seatId;
  room.pendingHint = null;
  // 剩余盲牌在提示窗口结算（含超时按 no）之后才对本人翻开。
  revealRemainingBlindCardsIfNeeded(room);
  continueAfterPlacement(room, previousSeat);
};
