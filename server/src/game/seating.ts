import type { GameRoom, Seat, SeatId } from "@take-time/shared";

export const defaultAvatarPaths = ["/images/avatar1jpg.jpg", "/images/avatar2.jpg"] as const;

const isDefaultAvatar = (avatar: string | null | undefined) =>
  defaultAvatarPaths.includes(avatar as (typeof defaultAvatarPaths)[number]);

export const assignDefaultAvatar = (room: GameRoom, seat: Seat) => {
  const usedDefaultAvatars = new Set(
    room.seats
      .filter((candidate) => candidate.id !== seat.id && candidate.nick && isDefaultAvatar(candidate.avatar))
      .map((candidate) => candidate.avatar)
  );
  const available = defaultAvatarPaths.filter((avatar) => !usedDefaultAvatars.has(avatar));
  const candidates = available.length > 0 ? available : defaultAvatarPaths;
  seat.avatar = candidates[Math.floor(Math.random() * candidates.length)] ?? defaultAvatarPaths[0];
};

export const attachSeat = (room: GameRoom, seat: Seat, socketId: string, nick: string, avatar?: string | null) => {
  seat.nick = nick;
  if (avatar) {
    seat.avatar = avatar;
  } else if (!seat.avatar) {
    assignDefaultAvatar(room, seat);
  }
  seat.connected = true;
  seat.socketId = socketId;
  seat.holdUntil = undefined;
};

export const findEmptySeat = (room: GameRoom) => room.seats.find((seat) => !seat.nick);

export const transferHostToConnectedSeat = (room: GameRoom, leavingSeatId: SeatId) => {
  if (room.host !== leavingSeatId) return;
  room.host = room.seats.find((seat) => seat.id !== leavingSeatId && seat.kind === "human" && seat.connected)?.id ?? null;
};

export const releaseSeat = (room: GameRoom, seat: Seat) => {
  transferHostToConnectedSeat(room, seat.id);
  seat.nick = null;
  seat.avatar = null;
  seat.kind = "human";
  seat.agentId = undefined;
  seat.connected = false;
  seat.socketId = undefined;
  room.ready[seat.id] = false;
};
