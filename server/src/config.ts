import "./env.js";
import type { RoomSettings } from "@take-time/shared";

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalNumberFromEnv = (name: string): number | null => {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const defaultSettings: RoomSettings = {
  discussionMinutes: 5,
  thinkSeconds: 10,
  hintMarkerCount: 3,
  capacity: 4
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? "./data",
  // 默认 60s，与前端 ~65s 重连窗口（client/src/socket/client.ts）对齐；
  // 本地快测可用 SEAT_HOLD_MS 环境变量覆盖回小值。
  seatHoldMs: numberFromEnv("SEAT_HOLD_MS", 60_000),
  // hint 窗口默认跟随 room.settings.thinkSeconds（与出牌思考时间等长）；
  // HINT_WINDOW_MS 仅供测试缩短窗口，生产不应设置。
  hintWindowOverrideMs: optionalNumberFromEnv("HINT_WINDOW_MS"),
  hostStartGraceMs: numberFromEnv("HOST_START_GRACE_MS", 15_000),
  roomPassword: process.env.ROOM_PASSWORD ?? "1234",
  // 管理员凭证：两者齐备且密码不同于房间密码才启用管理员登录；
  // 生产环境未配置时启动日志会给出警告（见 index.ts）。
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  // 32 字节主密钥（base64/base64url 或 64 位 hex），仅用于 HKDF 派生邮箱索引与加密子密钥。
  // 缺失或错误时账号仓库 fail-closed，不允许用空库继续运行。
  accountEmailKey: process.env.ACCOUNT_EMAIL_KEY ?? "",
  // server/index.ts resolves this relative to the compiled server/dist/ dir,
  // so it needs two levels up to reach the sibling client/dist.
  clientDistDir: process.env.CLIENT_DIST_DIR ?? "../../client/dist"
} as const;
