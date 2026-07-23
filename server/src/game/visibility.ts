import type { GameRoom, PublicHandCard, PublicPlacedCard, PublicRoomState, PublicSeat, Seat } from "@take-time/shared";

// 桌面暗牌颜色公开、数值遮蔽；提示翻开或最终揭示后公开数值。
export const publicPlacements = (room: GameRoom): PublicPlacedCard[][] =>
  room.placements.map((segment) =>
    segment.map((card) => {
      const visible = card.revealed || room.phase === "reveal" || room.phase === "result";
      return {
        id: card.id,
        owner: card.owner,
        revealed: card.revealed,
        placedAt: card.placedAt,
        playOrder: card.playOrder,
        color: card.color,
        ...(visible ? { value: card.value } : {})
      };
    })
  );

// 显式白名单映射：Seat 上新增的任何内部字段（凭证、管理标记等）默认不会被广播。
const toPublicSeat = (seat: Seat): PublicSeat => ({
  id: seat.id,
  kind: seat.kind,
  nick: seat.nick,
  avatar: seat.avatar,
  agentId: seat.agentId,
  connected: seat.connected
});

export const publicRoomState = (room: GameRoom): PublicRoomState => ({
  stateVersion: room.stateVersion,
  capacity: room.capacity,
  seats: room.seats.map(toPublicSeat),
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
  placements: publicPlacements(room),
  hintMarkers: room.hintMarkers,
  turn: room.turn,
  pendingHint: room.pendingHint,
  chat: room.chat,
  timer: room.timer,
  revealResult: room.revealResult,
  failureReason: room.failureReason,
  agentState: structuredClone(room.agentState)
});

export const privateHandForSeat = (room: GameRoom, seatId: string): PublicHandCard[] =>
  (room.hands[seatId as keyof typeof room.hands] ?? []).map((card) => ({
    id: card.id,
    owner: card.owner,
    visibleToOwner: card.visibleToOwner,
    ...(card.visibleToOwner ? { value: card.value, color: card.color } : {})
  }));
