import type { Challenge, GameRoom, LevelSummary, ProgressState, Seat, SeatId } from "@take-time/shared";
import { defaultSettings } from "../config.js";

const seatIds: SeatId[] = ["A", "B", "C", "D"];

export const createSeats = (capacity: 2 | 3 | 4): Seat[] =>
  seatIds.slice(0, capacity).map((id) => ({
    id,
    kind: "human",
    nick: null,
    connected: false
  }));

export const createEmptyPlacements = () => Array.from({ length: 6 }, () => []);

export const createLevelSummaries = (levels: Challenge[]): LevelSummary[] =>
  levels.map(({ id, name, levelIndex, difficulty, centerCap, playable, conditions, notes }) => ({
    id,
    name,
    levelIndex,
    difficulty,
    centerCap,
    playable,
    conditions,
    ...(notes ? { notes } : {})
  }));

export const createGameRoom = (progress: ProgressState, levelsOrTotal: Challenge[] | number): GameRoom => {
  const settings = {
    ...defaultSettings,
    ...progress.settings,
    capacity: 2 as const
  };
  const levelSummaries = Array.isArray(levelsOrTotal) ? createLevelSummaries(levelsOrTotal) : [];

  return {
    stateVersion: 0,
    capacity: settings.capacity,
    seats: createSeats(settings.capacity),
    ready: {},
    host: null,
    phase: "waiting",
    phaseVersion: 0,
    turnVersion: 0,
    settings,
    progress: {
      ...progress,
      settings
    },
    levelSummaries,
    currentLevelIndex: null,
    currentChallenge: null,
    hands: {},
    playedCount: {},
    placements: createEmptyPlacements(),
    hintMarkers: {
      total: settings.hintMarkerCount,
      used: 0
    },
    turn: null,
    pendingHint: null,
    chat: [],
    timer: null,
    timers: {},
    revealResult: null,
    failureReason: null
  };
};

export const resetRoundState = (room: GameRoom) => {
  room.hands = {};
  room.playedCount = {};
  room.placements = createEmptyPlacements();
  room.hintMarkers = {
    total: room.settings.hintMarkerCount,
    used: 0
  };
  room.turn = null;
  room.pendingHint = null;
  room.timer = null;
  room.revealResult = null;
  room.failureReason = null;
  room.phaseVersion += 1;
  room.turnVersion += 1;
};

export const softResetRoom = (room: GameRoom) => {
  room.seats = createSeats(room.capacity);
  room.ready = {};
  room.host = null;
  room.phase = "waiting";
  room.currentLevelIndex = null;
  room.currentChallenge = null;
  room.chat = [];
  resetRoundState(room);
};

export const activeSeatIds = (room: GameRoom) =>
  room.seats.filter((seat) => seat.nick).map((seat) => seat.id);

export const allSeatsOccupied = (room: GameRoom) => room.seats.every((seat) => Boolean(seat.nick));

export const findSeat = (room: GameRoom, seatId: SeatId | undefined | null) =>
  seatId ? room.seats.find((seat) => seat.id === seatId) : undefined;

export const isHost = (room: GameRoom, seatId: SeatId | undefined | null) => Boolean(seatId && room.host === seatId);

export const allReady = (room: GameRoom) =>
  allSeatsOccupied(room) && room.seats.every((seat) => room.ready[seat.id]);

export const totalPlacedCards = (room: GameRoom) =>
  room.placements.reduce((total, segment) => total + segment.length, 0);

export const totalLevelsInRoom = (_room: GameRoom, levelsLength: number) => levelsLength;
