import type { GameRoom, PublicHandCard, PublicRoomState } from "@take-time/shared";

export const publicRoomState = (room: GameRoom): PublicRoomState => ({
  capacity: room.capacity,
  seats: room.seats.map(({ socketId: _socketId, ...seat }) => seat),
  ready: room.ready,
  host: room.host,
  phase: room.phase,
  settings: room.settings,
  progress: {
    schemaVersion: room.progress.schemaVersion,
    clearedLevels: room.progress.clearedLevels
  },
  levelSummaries: room.levelSummaries,
  currentLevelIndex: room.currentLevelIndex,
  currentChallenge: room.currentChallenge,
  placements: room.placements.map((segment) =>
    segment.map((card) => {
      const visible = card.revealed || room.phase === "reveal" || room.phase === "result";
      return {
        id: card.id,
        owner: card.owner,
        revealed: card.revealed,
        placedAt: card.placedAt,
        playOrder: card.playOrder,
        ...(visible ? { value: card.value, color: card.color } : {})
      };
    })
  ),
  hintMarkers: room.hintMarkers,
  turn: room.turn,
  pendingHint: room.pendingHint,
  chat: room.chat,
  timer: room.timer,
  revealResult: room.revealResult,
  failureReason: room.failureReason
});

export const privateHandForSeat = (room: GameRoom, seatId: string): PublicHandCard[] =>
  (room.hands[seatId as keyof typeof room.hands] ?? []).map((card) => ({
    id: card.id,
    owner: card.owner,
    visibleToOwner: card.visibleToOwner,
    ...(card.visibleToOwner ? { value: card.value, color: card.color } : {})
  }));
