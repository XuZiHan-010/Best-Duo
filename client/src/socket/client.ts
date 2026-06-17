import { io, type Socket } from "socket.io-client";

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

// connect 在首次连接和每次重连成功时均触发
socket.on("connect", () => notify("connected"));
socket.on("disconnect", () => notify("reconnecting"));
// reconnect / reconnect_failed 是 Manager 级事件（socket.io-client v4）
socket.io.on("reconnect", () => notify("connected"));
socket.io.on("reconnect_failed", () => notify("disconnected"));

// Stamps credentials onto the Manager's handshake query so that automatic
// transport-level reconnects can re-attach the held seat.
export function setReconnectCredentials(nick: string, password: string) {
  (socket.io as unknown as { opts: { query: Record<string, string> } }).opts.query = { nick, password };
}

export function clearReconnectCredentials() {
  (socket.io as unknown as { opts: { query: Record<string, string> } }).opts.query = {};
}

export function connect(nick?: string) {
  if (nick) {
    const password = window.sessionStorage.getItem("takeTime.roomPassword");
    if (password) setReconnectCredentials(nick, password);
  }
  notify("connecting");
  socket.connect();
}

export function disconnect() {
  socket.disconnect();
}
