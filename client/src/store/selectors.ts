import { handSizeForPlayerCount, type PlayerCount, type SeatId } from "@take-time/shared";
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
  const { seats, ready } = store.roomState;
  const occupied = seats.filter((s) => s.nick !== null);
  if (occupied.length < 2 || occupied.length > 4) return false;
  const humans = occupied.filter((s) => s.kind === "human");
  if (humans.length === 0) return false;
  return occupied.every((s) => s.kind === "agent" || (s.connected && ready[s.id] === true));
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

export function teammateSeatsSelector(store: RoomStore) {
  const { roomState, myNick } = store;
  if (!roomState || !myNick) return [];
  return roomState.seats.filter((s) => s.nick !== null && s.nick !== myNick);
}

export function occupiedCountSelector(store: RoomStore): PlayerCount | null {
  const occupied = store.roomState?.seats.filter((s) => s.nick !== null).length ?? 0;
  return occupied === 2 || occupied === 3 || occupied === 4 ? occupied : null;
}

export function myPlayedCountSelector(store: RoomStore): number {
  const seatId = mySeatIdSelector(store);
  if (!seatId) return 0;
  return store.roomState?.placements.reduce(
    (count, segment) => count + segment.filter((card) => card.owner === seatId).length,
    0
  ) ?? 0;
}

export function myHandTotalSelector(store: RoomStore): number {
  const occupied = occupiedCountSelector(store);
  return occupied ? handSizeForPlayerCount(occupied) : store.myHand?.length ?? 0;
}

export function totalPlacedSelector(store: RoomStore): number {
  return store.roomState?.placements.reduce((s, seg) => s + seg.length, 0) ?? 0;
}

// Mirrors server allConnectedPlayersReady for flexible 2-4 player starts.
export function allReadySelector(store: RoomStore): boolean {
  const rs = store.roomState;
  if (!rs || rs.phase !== "waiting") return false;
  const occupied = rs.seats.filter((s) => s.nick !== null);
  if (occupied.length < 2 || occupied.length > 4) return false;
  if (!occupied.some((s) => s.kind === "human")) return false;
  return occupied.every((s) => s.kind === "agent" || Boolean(s.connected && rs.ready[s.id]));
}
