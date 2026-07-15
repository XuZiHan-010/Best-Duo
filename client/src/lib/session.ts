import type { PlayerSessionPayload } from "@take-time/shared";

// 玩家会话凭证只存 sessionStorage（同标签页刷新/断网恢复），
// 绝不写入 URL、DOM 或任何公共调试状态。
const KEY = "takeTime.playerSession";

export function savePlayerSession(session: PlayerSessionPayload): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function loadPlayerSession(): PlayerSessionPayload | null {
  const raw = window.sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlayerSessionPayload;
    return parsed.playerId && parsed.reconnectToken && parsed.seatId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlayerSession(): void {
  window.sessionStorage.removeItem(KEY);
}
