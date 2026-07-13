import type { Challenge, GameRoom, LevelSummary, PlayerCount, ProgressState, Seat, SeatId } from "@take-time/shared";
import { defaultSettings } from "../config.js";

const seatIds: SeatId[] = ["A", "B", "C", "D"];

export const createSeats = (capacity: PlayerCount): Seat[] =>
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
    capacity: 4 as const
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

export const occupiedSeats = (room: GameRoom) => room.seats.filter((seat) => Boolean(seat.nick));

export const humanSeats = (room: GameRoom) => occupiedSeats(room).filter((seat) => seat.kind === "human");

export const occupiedPlayerCount = (room: GameRoom): PlayerCount => {
  const count = occupiedSeats(room).length;
  if (count === 2 || count === 3 || count === 4) return count;
  throw new Error("需要 2-4 名玩家才能开始");
};

export const activeSeatIds = (room: GameRoom) => occupiedSeats(room).map((seat) => seat.id);

export const allSeatsOccupied = (room: GameRoom) => room.seats.every((seat) => Boolean(seat.nick));

export const findSeat = (room: GameRoom, seatId: SeatId | undefined | null) =>
  seatId ? room.seats.find((seat) => seat.id === seatId) : undefined;

export const isHost = (room: GameRoom, seatId: SeatId | undefined | null) => Boolean(seatId && room.host === seatId);

export const allReady = (room: GameRoom) => {
  const humans = humanSeats(room);
  return humans.length > 0 && humans.every((seat) => room.ready[seat.id]);
};

export const canStartGame = (room: GameRoom) => {
  if (room.phase !== "waiting") return false;
  const occupied = occupiedSeats(room);
  if (occupied.length < 2 || occupied.length > 4) return false;
  if (!allReady(room)) return false;
  return occupied.every((seat) => seat.kind === "agent" || seat.connected);
};

export const totalPlacedCards = (room: GameRoom) =>
  room.placements.reduce((total, segment) => total + segment.length, 0);

export const totalLevelsInRoom = (_room: GameRoom, levelsLength: number) => levelsLength;
