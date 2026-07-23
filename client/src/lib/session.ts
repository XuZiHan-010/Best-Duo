import type { AccountSessionPayload, PlayerSessionPayload } from "@take-time/shared";

// 玩家会话凭证只存 sessionStorage（同标签页刷新/断网恢复），
// 绝不写入 URL、DOM 或任何公共调试状态。
const KEY = "takeTime.playerSession";
const ACCOUNT_KEY = "takeTime.accountSession";

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

export function saveAccountSession(session: AccountSessionPayload): void {
  window.sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(session));
}

export function loadAccountSession(): AccountSessionPayload | null {
  const raw = window.sessionStorage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccountSessionPayload;
    return parsed.playerId && parsed.accountToken ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAccountSession(): void {
  window.sessionStorage.removeItem(ACCOUNT_KEY);
}
