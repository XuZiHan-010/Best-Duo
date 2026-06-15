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
