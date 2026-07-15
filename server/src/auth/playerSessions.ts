import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SeatId } from "@take-time/shared";

// 轮换宽限期：服务端已轮换但客户端未落盘新令牌时，旧令牌在此窗口内仍可完成一次重连。
export const ROTATION_GRACE_MS = 30_000;

interface PlayerSessionRecord {
  playerId: string;
  seatId: SeatId;
  tokenHash: Buffer;
  previousTokenHash: Buffer | null;
  previousTokenExpiresAt: number;
  issuedAt: number;
  isAdmin: boolean;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest();
const hashEquals = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export class PlayerSessionStore {
  private records = new Map<string, PlayerSessionRecord>();

  issue(seatId: SeatId, options?: { isAdmin?: boolean }): { playerId: string; reconnectToken: string } {
    this.revokeBySeat(seatId);
    const playerId = randomBytes(16).toString("base64url");
    const reconnectToken = randomBytes(32).toString("base64url");
    this.records.set(playerId, {
      playerId,
      seatId,
      tokenHash: hashToken(reconnectToken),
      previousTokenHash: null,
      previousTokenExpiresAt: 0,
      issuedAt: Date.now(),
      isAdmin: options?.isAdmin === true
    });
    return { playerId, reconnectToken };
  }

  verify(playerId: string, token: string): SeatId | null {
    const record = this.records.get(playerId);
    if (!record) return null;
    const candidate = hashToken(token);
    if (hashEquals(candidate, record.tokenHash)) return record.seatId;
    if (
      record.previousTokenHash &&
      Date.now() < record.previousTokenExpiresAt &&
      hashEquals(candidate, record.previousTokenHash)
    ) {
      return record.seatId;
    }
    return null;
  }

  rotate(playerId: string): string | null {
    const record = this.records.get(playerId);
    if (!record) return null;
    const reconnectToken = randomBytes(32).toString("base64url");
    record.previousTokenHash = record.tokenHash;
    record.previousTokenExpiresAt = Date.now() + ROTATION_GRACE_MS;
    record.tokenHash = hashToken(reconnectToken);
    return reconnectToken;
  }

  revoke(playerId: string): void {
    this.records.delete(playerId);
  }

  revokeBySeat(seatId: SeatId): void {
    for (const record of this.records.values()) {
      if (record.seatId === seatId) this.records.delete(record.playerId);
    }
  }

  revokeAll(): void {
    this.records.clear();
  }

  seatOf(playerId: string): SeatId | null {
    return this.records.get(playerId)?.seatId ?? null;
  }

  isAdmin(playerId: string): boolean {
    return this.records.get(playerId)?.isAdmin === true;
  }

  findAdminPlayerId(): string | null {
    for (const record of this.records.values()) {
      if (record.isAdmin) return record.playerId;
    }
    return null;
  }
}
