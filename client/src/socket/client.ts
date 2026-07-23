import { io, type Socket } from "socket.io-client";
import type { AccountSessionPayload, PlayerSessionPayload } from "@take-time/shared";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

type ConnectionCallback = (state: ConnectionState) => void;

const listeners = new Set<ConnectionCallback>();

export function onConnectionChange(cb: ConnectionCallback): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(state: ConnectionState) {
  listeners.forEach((cb) => cb(state));
}

// 超出后端座位保留期（60s）后放弃重连
const SEAT_HOLD_MS = 65000;
const MAX_RECONNECT_ATTEMPTS = Math.ceil(SEAT_HOLD_MS / 1000 / 2); // ~33 次，约 66s

export const socket: Socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 2000,
  reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
});

let playerSessionAuth: PlayerSessionPayload | null = null;
let accountSessionAuth: AccountSessionPayload | null = null;

const applySessionAuth = () => {
  socket.auth = {
    ...(playerSessionAuth
      ? { playerId: playerSessionAuth.playerId, reconnectToken: playerSessionAuth.reconnectToken }
      : {}),
    ...(accountSessionAuth
      ? { accountPlayerId: accountSessionAuth.playerId, accountToken: accountSessionAuth.accountToken }
      : {})
  };
};

// connect 在首次连接和每次重连成功时均触发
socket.on("connect", () => notify("connected"));
socket.on("disconnect", () => notify("reconnecting"));
// reconnect / reconnect_failed 是 Manager 级事件（socket.io-client v4）
socket.io.on("reconnect", () => notify("connected"));
socket.io.on("reconnect_failed", () => notify("disconnected"));

// 会话凭证写入 handshake auth：transport 级自动重连时随新握手提交，
// 服务端验证后静默恢复座位。令牌不进 URL query。
export function setSessionAuth(session: PlayerSessionPayload | null) {
  playerSessionAuth = session;
  applySessionAuth();
}

export function setAccountSessionAuth(session: AccountSessionPayload | null) {
  accountSessionAuth = session;
  applySessionAuth();
}

export function connect() {
  notify("connecting");
  socket.connect();
}

export function disconnect() {
  socket.disconnect();
}
