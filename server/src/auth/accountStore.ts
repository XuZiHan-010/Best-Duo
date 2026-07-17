import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const FILE_NAME = "accounts.json";
const scryptAsync = promisify<crypto.BinaryLike, crypto.BinaryLike, number, crypto.ScryptOptions, Buffer>(
  crypto.scrypt
);

// 当前默认 KDF 参数；随记录版本化存储，将来加强成本参数时按 kdf 字段兼容旧账号
const CURRENT_KDF = { algo: "scrypt", N: 16384, r: 8, p: 1, keylen: 64, version: 1 } as const;

export interface AccountKdfParams {
  algo: "scrypt";
  N: number;
  r: number;
  p: number;
  keylen: 64;
  version: 1;
}

export interface PlayerAccount {
  playerId: string;
  nick: string;
  avatar: string | null;
  passwordSalt: string;
  passwordHash: string;
  kdf: AccountKdfParams;
  createdAt: number;
}

export type AccountVerifyResult =
  | { ok: true; account: PlayerAccount; created: boolean }
  | { ok: false; reason: "password_mismatch" }
  | { ok: false; reason: "store_unavailable" };

export interface AccountStore {
  verifyOrRegister(input: {
    nick: string;
    accountPassword: string;
    avatar: string | null;
  }): Promise<AccountVerifyResult>;
  getByPlayerId(playerId: string): PlayerAccount | null;
}

interface AccountsFile {
  schemaVersion: 1;
  accounts: PlayerAccount[];
}

const isKdf = (value: unknown): value is AccountKdfParams => {
  const record = value as Partial<AccountKdfParams> | null;
  return Boolean(
    record &&
      record.algo === "scrypt" &&
      typeof record.N === "number" &&
      typeof record.r === "number" &&
      typeof record.p === "number" &&
      record.keylen === 64 &&
      record.version === 1
  );
};

const isAccount = (value: unknown): value is PlayerAccount => {
  const record = value as Partial<PlayerAccount> | null;
  return Boolean(
    record &&
      typeof record.playerId === "string" &&
      typeof record.nick === "string" &&
      (record.avatar === null || typeof record.avatar === "string") &&
      typeof record.passwordSalt === "string" &&
      typeof record.passwordHash === "string" &&
      isKdf(record.kdf) &&
      typeof record.createdAt === "number"
  );
};

const hashPassword = (password: string, salt: Buffer, kdf: AccountKdfParams) =>
  scryptAsync(password, salt, kdf.keylen, { N: kdf.N, r: kdf.r, p: kdf.p });

export const createAccountStore = (dataDir: string): AccountStore => {
  const filePath = path.resolve(dataDir, FILE_NAME);
  const byNick = new Map<string, PlayerAccount>();
  // fail-closed：账户文件存在但无法解析时进入降级态——拒绝注册与密码登录，绝不写盘覆盖，
  // 否则旧昵称可被新密码"重新注册"（身份接管）。持有效会话的玩家不经过本仓库，不受影响。
  let degraded = false;

  const load = () => {
    if (!fs.existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AccountsFile>;
      if (!parsed || !Array.isArray(parsed.accounts)) throw new Error("invalid accounts file shape");
      for (const account of parsed.accounts) {
        if (!isAccount(account)) throw new Error("invalid account record");
        if (byNick.has(account.nick)) continue;
        byNick.set(account.nick, account);
      }
    } catch (error) {
      degraded = true;
      byNick.clear();
      console.warn(JSON.stringify({ event: "accounts:load_failed", error: String(error) }));
    }
  };

  load();

  const persist = () => {
    if (degraded) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    const body = `${JSON.stringify({ schemaVersion: 1, accounts: [...byNick.values()] }, null, 2)}\n`;
    fs.writeFileSync(tmpPath, body, "utf8");
    fs.renameSync(tmpPath, filePath);
  };

  return {
    async verifyOrRegister({ nick, accountPassword, avatar }) {
      if (degraded) return { ok: false, reason: "store_unavailable" };

      const existing = byNick.get(nick);
      if (existing) {
        const expected = Buffer.from(existing.passwordHash, "base64");
        const actual = await hashPassword(accountPassword, Buffer.from(existing.passwordSalt, "base64"), existing.kdf);
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
          return { ok: false, reason: "password_mismatch" };
        }
        return { ok: true, account: existing, created: false };
      }

      const salt = crypto.randomBytes(16);
      const hash = await hashPassword(accountPassword, salt, CURRENT_KDF);
      // await 期间可能有并发同昵称注册先落库，重查后走验证分支避免覆盖
      if (byNick.has(nick)) return this.verifyOrRegister({ nick, accountPassword, avatar });
      const account: PlayerAccount = {
        playerId: crypto.randomBytes(16).toString("base64url"),
        nick,
        avatar,
        passwordSalt: salt.toString("base64"),
        passwordHash: hash.toString("base64"),
        kdf: { ...CURRENT_KDF },
        createdAt: Date.now()
      };
      byNick.set(nick, account);
      persist();
      return { ok: true, account, created: true };
    },

    getByPlayerId(playerId) {
      for (const account of byNick.values()) if (account.playerId === playerId) return account;
      return null;
    }
  };
};
