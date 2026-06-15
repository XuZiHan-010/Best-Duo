import type { GameRoom, Seat, SeatId } from "@take-time/shared";

export const attachSeat = (seat: Seat, socketId: string, nick: string) => {
  seat.nick = nick;
  seat.connected = true;
  seat.socketId = socketId;
  seat.holdUntil = undefined;
};

export const findReconnectSeat = (room: GameRoom, nick: string) =>
  room.seats.find((seat) => seat.nick === nick && !seat.connected && (!seat.holdUntil || seat.holdUntil > Date.now()));

export const findEmptySeat = (room: GameRoom) => room.seats.find((seat) => !seat.nick);

export const transferHostToConnectedSeat = (room: GameRoom, leavingSeatId: SeatId) => {
  if (room.host !== leavingSeatId) return;
  room.host = room.seats.find((seat) => seat.id !== leavingSeatId && seat.connected)?.id ?? null;
};

export const releaseSeat = (room: GameRoom, seat: Seat) => {
  transferHostToConnectedSeat(room, seat.id);
  seat.nick = null;
  seat.connected = false;
  seat.socketId = undefined;
  room.ready[seat.id] = false;
};
