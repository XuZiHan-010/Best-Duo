import type { RoomSettings } from "@take-time/shared";

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const defaultSettings: RoomSettings = {
  discussionMinutes: 5,
  thinkSeconds: 5,
  hintMarkerCount: 3,
  capacity: 2
};

export const config = {
  port: numberFromEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? "./data",
  seatHoldMs: numberFromEnv("SEAT_HOLD_MS", 60_000),
  hintWindowMs: numberFromEnv("HINT_WINDOW_MS", 5_000),
  revealHoldMs: numberFromEnv("REVEAL_HOLD_MS", 3_000),
  clientDistDir: process.env.CLIENT_DIST_DIR ?? "../client/dist"
} as const;
