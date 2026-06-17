import type { SeatId } from "@take-time/shared";
import type { RoomStore } from "./useRoomStore.js";

export function mySeatSelector(store: RoomStore) {
  const { roomState, myNick } = store;
  if (!roomState || !myNick) return null;
  return roomState.seats.find((s) => s.nick === myNick) ?? null;
}

export function mySeatIdSelector(store: RoomStore): SeatId | null {
  return mySeatSelector(store)?.id ?? null;
}

export function isHostSelector(store: RoomStore): boolean {
  const seatId = mySeatIdSelector(store);
  return seatId !== null && store.roomState?.host === seatId;
}

export function isMyTurnSelector(store: RoomStore): boolean {
  const seatId = mySeatIdSelector(store);
  if (!seatId || !store.roomState) return false;
  const turn = store.roomState.turn;
  return turn === "race" || turn === seatId;
}

export function hintLeftSelector(store: RoomStore): number {
  const hm = store.roomState?.hintMarkers;
  if (!hm) return 0;
  return hm.total - hm.used;
}

export function canStartSelector(store: RoomStore): boolean {
  if (!isHostSelector(store) || !store.roomState) return false;
  const { seats, ready, capacity } = store.roomState;
  const occupied = seats.filter((s) => s.nick !== null);
  if (occupied.length < capacity) return false;
  return occupied.every((s) => ready[s.id] === true);
}

export function allOccupiedSelector(store: RoomStore): boolean {
  const rs = store.roomState;
  if (!rs) return false;
  return rs.seats.filter((s) => s.nick !== null).length >= rs.capacity;
}

export function opponentSeatSelector(store: RoomStore) {
  const { roomState, myNick } = store;
  if (!roomState || !myNick) return null;
  return roomState.seats.find((s) => s.nick !== null && s.nick !== myNick) ?? null;
}

// In this co-op game the other player is a teammate, not an opponent. Alias for clarity at call sites.
export const teammateSeatSelector = opponentSeatSelector;

export function myPlayedCountSelector(store: RoomStore): number {
  if (!store.myHand) return 0;
  // Server removes played cards from player:hand; played = started with 6 - remaining.
  // 2 人 MVP 硬编码起始手牌数为 6；N 人支持需改为按 dealRules 派生起始手牌数。
  return Math.max(0, 6 - store.myHand.length);
}

export function totalPlacedSelector(store: RoomStore): number {
  return store.roomState?.placements.reduce((s, seg) => s + seg.length, 0) ?? 0;
}

// Mirrors server allConnectedPlayersReady: all capacity seats have a nick, are connected, and ready.
export function allReadySelector(store: RoomStore): boolean {
  const rs = store.roomState;
  if (!rs || rs.phase !== "waiting") return false;
  return rs.seats.every((s) => Boolean(s.nick && s.connected && rs.ready[s.id]));
}
