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
  credentialVersion: number | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest();
const hashEquals = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export class PlayerSessionStore {
  private records = new Map<string, PlayerSessionRecord>();

  issue(
    seatId: SeatId,
    options?: { isAdmin?: boolean; playerId?: string; credentialVersion?: number }
  ): { playerId: string; reconnectToken: string } {
    this.revokeBySeat(seatId);
    // 账号体系（ADR-0006）下传入账号的持久 playerId；未传时内部生成（管理员等路径）。
    const playerId = options?.playerId ?? randomBytes(16).toString("base64url");
    const reconnectToken = randomBytes(32).toString("base64url");
    this.records.set(playerId, {
      playerId,
      seatId,
      tokenHash: hashToken(reconnectToken),
      previousTokenHash: null,
      previousTokenExpiresAt: 0,
      issuedAt: Date.now(),
      isAdmin: options?.isAdmin === true,
      credentialVersion: options?.credentialVersion ?? null
    });
    return { playerId, reconnectToken };
  }

  verify(playerId: string, token: string, credentialVersion?: number): SeatId | null {
    const record = this.records.get(playerId);
    if (!record) return null;
    if (
      record.credentialVersion !== null &&
      (credentialVersion === undefined || record.credentialVersion !== credentialVersion)
    ) {
      this.records.delete(playerId);
      return null;
    }
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

  credentialVersionOf(playerId: string): number | null {
    return this.records.get(playerId)?.credentialVersion ?? null;
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

  isAdminSeat(seatId: SeatId): boolean {
    for (const record of this.records.values()) {
      if (record.seatId === seatId && record.isAdmin) return true;
    }
    return false;
  }

  findAdminPlayerId(): string | null {
    for (const record of this.records.values()) {
      if (record.isAdmin) return record.playerId;
    }
    return null;
  }
}
