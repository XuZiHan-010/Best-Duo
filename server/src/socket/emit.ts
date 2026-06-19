import type { Server, Socket } from "socket.io";
import { ServerEvents, type GameRoom, type SeatId } from "@take-time/shared";
import { privateHandForSeat, publicRoomState } from "../game/visibility.js";

export const emitRoomError = (socket: Socket, code: string, message: string) => {
  socket.emit(ServerEvents.RoomError, { code, message });
};

const advanceStateVersion = (room: GameRoom) => {
  room.stateVersion += 1;
};

const stateLogPayload = (room: GameRoom, reason: string) => ({
  event: "room:state_emit",
  reason,
  stateVersion: room.stateVersion,
  phase: room.phase,
  turn: room.turn,
  pendingHint: room.pendingHint
    ? {
        seatId: room.pendingHint.seatId,
        cardId: room.pendingHint.cardId,
        segment: room.pendingHint.segment
      }
    : null
});

export const emitStateToSocket = (socket: Socket, room: GameRoom, reason = "sync") => {
  advanceStateVersion(room);
  socket.emit(ServerEvents.RoomState, publicRoomState(room));
  if (room.timer) socket.emit(ServerEvents.TimerSync, room.timer);

  const seatId = socket.data.seatId as SeatId | undefined;
  if (seatId) socket.emit(ServerEvents.PlayerHand, privateHandForSeat(room, seatId));

  console.log(JSON.stringify({ ...stateLogPayload(room, reason), socketId: socket.id }));
};

export const emitStateToAll = (io: Server, room: GameRoom, reason = "broadcast") => {
  advanceStateVersion(room);
  io.emit(ServerEvents.RoomState, publicRoomState(room));
  if (room.timer) io.emit(ServerEvents.TimerSync, room.timer);

  for (const seat of room.seats) {
    if (!seat.socketId || !seat.nick) continue;
    io.to(seat.socketId).emit(ServerEvents.PlayerHand, privateHandForSeat(room, seat.id));
  }

  if (reason !== "broadcast") {
    console.log(
      JSON.stringify({
        ...stateLogPayload(room, reason),
        recipients: room.seats.filter((seat) => seat.socketId).length
      })
    );
  }
};
