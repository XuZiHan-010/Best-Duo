import type { GameRoom, SeatId } from "@take-time/shared";

export const nextSeatAfter = (room: GameRoom, seatId: SeatId): SeatId => {
  const occupied = room.seats.filter((seat) => seat.nick).map((seat) => seat.id);
  const currentIndex = occupied.indexOf(seatId);
  if (currentIndex < 0) return occupied[0] ?? "A";
  return occupied[(currentIndex + 1) % occupied.length];
};
