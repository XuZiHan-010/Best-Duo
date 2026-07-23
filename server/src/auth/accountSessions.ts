import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

interface AccountSessionRecord {
  playerId: string;
  tokenHash: Buffer;
  credentialVersion: number;
  issuedAt: number;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest();
const hashKey = (hash: Buffer) => hash.toString("hex");
const hashEquals = (left: Buffer, right: Buffer) =>
  left.length === right.length && timingSafeEqual(left, right);

/**
 * 账号登录态与座位所有权分离：账号 session 只授权资料维护，不能读手牌、
 * 出牌或恢复座位。仓库仍为单进程内存态，进程重启后要求重新登录。
 */
export class AccountSessionStore {
  private readonly records = new Map<string, AccountSessionRecord>();

  issue(playerId: string, credentialVersion: number) {
    const accountToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(accountToken);
    this.records.set(hashKey(tokenHash), {
      playerId,
      tokenHash,
      credentialVersion,
      issuedAt: Date.now()
    });
    return { playerId, accountToken };
  }

  verify(playerId: string, token: string, credentialVersion: number): boolean {
    const candidate = hashToken(token);
    const key = hashKey(candidate);
    const record = this.records.get(key);
    if (!record || record.playerId !== playerId || !hashEquals(candidate, record.tokenHash)) return false;
    if (record.credentialVersion !== credentialVersion) {
      this.records.delete(key);
      return false;
    }
    return true;
  }

  revokeOthers(playerId: string, keepToken: string) {
    const keepHash = hashToken(keepToken);
    for (const [key, record] of this.records) {
      if (record.playerId === playerId && !hashEquals(record.tokenHash, keepHash)) this.records.delete(key);
    }
  }

  revokePlayer(playerId: string) {
    for (const [key, record] of this.records) {
      if (record.playerId === playerId) this.records.delete(key);
    }
  }

  revokeAll() {
    this.records.clear();
  }
}
