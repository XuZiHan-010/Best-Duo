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
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? "./data",
  // 默认 60s，与前端 ~65s 重连窗口（client/src/socket/client.ts）对齐；
  // 本地快测可用 SEAT_HOLD_MS 环境变量覆盖回小值。
  seatHoldMs: numberFromEnv("SEAT_HOLD_MS", 60_000),
  hintWindowMs: numberFromEnv("HINT_WINDOW_MS", 5_000),
  hostStartGraceMs: numberFromEnv("HOST_START_GRACE_MS", 15_000),
  roomPassword: process.env.ROOM_PASSWORD ?? "1234",
  // server/index.ts resolves this relative to the compiled server/dist/ dir,
  // so it needs two levels up to reach the sibling client/dist.
  clientDistDir: process.env.CLIENT_DIST_DIR ?? "../../client/dist"
} as const;
