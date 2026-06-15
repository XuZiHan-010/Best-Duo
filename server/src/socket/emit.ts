import type { Server, Socket } from "socket.io";
import { ServerEvents, type GameRoom } from "@take-time/shared";
import { privateHandForSeat, publicRoomState } from "../game/visibility.js";

export const emitRoomError = (socket: Socket, code: string, message: string) => {
  socket.emit(ServerEvents.RoomError, { code, message });
};

export const emitStateToAll = (io: Server, room: GameRoom) => {
  io.emit(ServerEvents.RoomState, publicRoomState(room));
  if (room.timer) io.emit(ServerEvents.TimerSync, room.timer);

  for (const seat of room.seats) {
    if (!seat.socketId || !seat.nick) continue;
    io.to(seat.socketId).emit(ServerEvents.PlayerHand, privateHandForSeat(room, seat.id));
  }
};

