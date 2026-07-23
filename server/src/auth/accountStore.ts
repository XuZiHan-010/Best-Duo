import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const FILE_NAME = "accounts.json";
const AUDIT_FILE_NAME = "account-admin-audit.jsonl";
const EMAIL_KEY_VERSION = 1;
const DUMMY_PASSWORD_SALT = Buffer.from("take-time-login-dummy-salt-v1", "utf8");
const scryptAsync = promisify<crypto.BinaryLike, crypto.BinaryLike, number, crypto.ScryptOptions, Buffer>(
  crypto.scrypt
);

export const CURRENT_KDF = { algo: "scrypt", N: 16384, r: 8, p: 1, keylen: 64, version: 1 } as const;
export const DEFAULT_ACCOUNT_AVATARS = ["/images/avatar1jpg.jpg", "/images/avatar2.jpg"] as const;

export interface AccountKdfParams {
  algo: "scrypt";
  N: number;
  r: number;
  p: number;
  keylen: 64;
  version: 1;
}

export type AccountStatus = "active" | "disabled" | "deleted";

export interface PlayerAccountV2 {
  playerId: string;
  nickname: string | null;
  nicknameNormalized: string | null;
  avatar: string | null;
  emailLookupHash: string | null;
  emailCiphertext: string | null;
  emailIv: string | null;
  emailAuthTag: string | null;
  emailKeyVersion: number;
  passwordSalt: string | null;
  passwordHash: string | null;
  kdf: AccountKdfParams | null;
  credentialVersion: number;
  status: AccountStatus;
  createdAt: number;
  updatedAt: number;
  nicknameChangedAt: number | null;
  passwordChangedAt: number;
  deletedAt: number | null;
}

export interface AccountIdentity {
  playerId: string;
  nickname: string;
  avatar: string;
  credentialVersion: number;
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  nicknameChangedAt: number | null;
  passwordChangedAt: number;
}

export interface AccountProfile extends AccountIdentity {
  email: string;
}

export interface AdminAccountView {
  playerId: string;
  nickname: string | null;
  avatar: string | null;
  maskedEmail: string | null;
  emailVerified: false;
  status: AccountStatus;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
  deletedAt: number | null;
}

export type AccountRegisterResult =
  | { ok: true; account: AccountProfile }
  | { ok: false; reason: "email_taken" | "nickname_unavailable" | "store_unavailable" };

export type AccountAuthenticateResult =
  | { ok: true; account: AccountProfile }
  | { ok: false; reason: "invalid_credentials" | "store_unavailable" };

export type AccountPasswordVerifyResult =
  | { ok: true; account: AccountProfile }
  | { ok: false; reason: "invalid_credentials" | "store_unavailable" };

export type AccountMutationResult =
  | { ok: true; account: AccountProfile }
  | {
      ok: false;
      reason: "invalid_credentials" | "email_taken" | "nickname_unavailable" | "not_found" | "store_unavailable";
    };

export interface AccountAdminAuditEntry {
  auditId: string;
  operator: string;
  targetPlayerId: string;
  action: "forceLogout" | "setStatus" | "softDelete";
  at: number;
  reason: string;
  result: "pending" | "success" | "failure";
}

export interface AccountStore {
  register(input: {
    email: string;
    password: string;
    nickname: string;
    avatar?: string | null;
  }): Promise<AccountRegisterResult>;
  authenticate(input: { email: string; password: string }): Promise<AccountAuthenticateResult>;
  verifyPassword(playerId: string, password: string): Promise<AccountPasswordVerifyResult>;
  getByPlayerId(playerId: string): AccountIdentity | null;
  getProfile(playerId: string): AccountProfile | null;
  updateProfile(
    playerId: string,
    input: { nickname: string; avatar?: string | null }
  ): Promise<AccountMutationResult>;
  updateNickname(playerId: string, nickname: string): Promise<AccountMutationResult>;
  changePassword(playerId: string, currentPassword: string, newPassword: string): Promise<AccountMutationResult>;
  changeEmail(playerId: string, currentPassword: string, newEmail: string): Promise<AccountMutationResult>;
  listAccounts(input?: { query?: string; status?: AccountStatus | "all" }): AdminAccountView[];
  setStatus(playerId: string, status: "active" | "disabled"): Promise<AccountMutationResult>;
  softDelete(playerId: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "store_unavailable" }>;
  appendAdminAudit(entry: AccountAdminAuditEntry): boolean;
  isAvailable(): boolean;
}

interface AccountsFileV2 {
  schemaVersion: 2;
  accounts: PlayerAccountV2[];
}

interface EmailKeys {
  indexKey: Buffer;
  cipherKey: Buffer;
}

export const normalizeEmail = (email: string): string => {
  const trimmed = email.trim();
  const separator = trimmed.lastIndexOf("@");
  if (separator <= 0) return trimmed;
  return `${trimmed.slice(0, separator)}@${trimmed.slice(separator + 1).toLowerCase()}`;
};

export const normalizeNickname = (nickname: string): string => nickname.trim().normalize("NFKC").toLowerCase();

const stableHashNumber = (value: string) => {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
};

export const defaultAvatarForPlayer = (playerId: string): string =>
  DEFAULT_ACCOUNT_AVATARS[stableHashNumber(playerId) % DEFAULT_ACCOUNT_AVATARS.length];

const parseMasterKey = (encoded: string | undefined): Buffer | null => {
  if (!encoded) return null;
  const value = encoded.trim();
  try {
    const decoded = /^[0-9a-fA-F]{64}$/.test(value)
      ? Buffer.from(value, "hex")
      : Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
};

const deriveEmailKeys = (encodedMasterKey: string | undefined): EmailKeys | null => {
  const masterKey = parseMasterKey(encodedMasterKey);
  if (!masterKey) return null;
  return {
    indexKey: Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), "email-index", 32)),
    cipherKey: Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), "email-cipher", 32))
  };
};

const emailLookupHash = (keys: EmailKeys, normalizedEmail: string) =>
  crypto.createHmac("sha256", keys.indexKey).update(normalizedEmail).digest("base64url");

const encryptEmail = (keys: EmailKeys, normalizedEmail: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizedEmail, "utf8"), cipher.final()]);
  return {
    emailCiphertext: ciphertext.toString("base64"),
    emailIv: iv.toString("base64"),
    emailAuthTag: cipher.getAuthTag().toString("base64")
  };
};

const decryptEmail = (keys: EmailKeys, account: PlayerAccountV2): string => {
  if (!account.emailCiphertext || !account.emailIv || !account.emailAuthTag) {
    throw new Error("account email is unavailable");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", keys.cipherKey, Buffer.from(account.emailIv, "base64"));
  decipher.setAuthTag(Buffer.from(account.emailAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(account.emailCiphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const maskEmail = (email: string): string => {
  const [local = "", domain = ""] = email.split("@");
  const visible = Array.from(local)[0] ?? "*";
  return `${visible}***@${domain}`;
};

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

const isNullableString = (value: unknown) => value === null || typeof value === "string";

const isAccount = (value: unknown): value is PlayerAccountV2 => {
  const record = value as Partial<PlayerAccountV2> | null;
  if (
    !record ||
    typeof record.playerId !== "string" ||
    !isNullableString(record.nickname) ||
    !isNullableString(record.nicknameNormalized) ||
    !isNullableString(record.avatar) ||
    !isNullableString(record.emailLookupHash) ||
    !isNullableString(record.emailCiphertext) ||
    !isNullableString(record.emailIv) ||
    !isNullableString(record.emailAuthTag) ||
    typeof record.emailKeyVersion !== "number" ||
    !isNullableString(record.passwordSalt) ||
    !isNullableString(record.passwordHash) ||
    !(record.kdf === null || isKdf(record.kdf)) ||
    typeof record.credentialVersion !== "number" ||
    !["active", "disabled", "deleted"].includes(record.status ?? "") ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number" ||
    !(record.nicknameChangedAt === null || typeof record.nicknameChangedAt === "number") ||
    typeof record.passwordChangedAt !== "number" ||
    !(record.deletedAt === null || typeof record.deletedAt === "number")
  ) {
    return false;
  }
  if (record.status === "deleted") return record.deletedAt !== null;
  return Boolean(
    record.nickname &&
      record.nicknameNormalized &&
      record.emailLookupHash &&
      record.emailCiphertext &&
      record.emailIv &&
      record.emailAuthTag &&
      record.emailKeyVersion === EMAIL_KEY_VERSION &&
      record.passwordSalt &&
      record.passwordHash &&
      record.kdf &&
      record.deletedAt === null
  );
};

const hashPassword = (password: string, salt: Buffer, kdf: AccountKdfParams) =>
  scryptAsync(password, salt, kdf.keylen, { N: kdf.N, r: kdf.r, p: kdf.p });

const passwordMatches = async (account: PlayerAccountV2, password: string) => {
  if (!account.passwordHash || !account.passwordSalt || !account.kdf) return false;
  const expected = Buffer.from(account.passwordHash, "base64");
  const actual = await hashPassword(password, Buffer.from(account.passwordSalt, "base64"), account.kdf);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const identityOf = (account: PlayerAccountV2): AccountIdentity | null => {
  if (account.status === "deleted" || !account.nickname) return null;
  return {
    playerId: account.playerId,
    nickname: account.nickname,
    avatar: account.avatar ?? defaultAvatarForPlayer(account.playerId),
    credentialVersion: account.credentialVersion,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    nicknameChangedAt: account.nicknameChangedAt,
    passwordChangedAt: account.passwordChangedAt
  };
};

export const createAccountStore = (
  dataDir: string,
  encodedEmailKey: string | undefined = process.env.ACCOUNT_EMAIL_KEY
): AccountStore => {
  const filePath = path.resolve(dataDir, FILE_NAME);
  const auditPath = path.resolve(dataDir, AUDIT_FILE_NAME);
  const keys = deriveEmailKeys(encodedEmailKey);
  const byId = new Map<string, PlayerAccountV2>();
  const byEmailHash = new Map<string, PlayerAccountV2>();
  const byNickname = new Map<string, PlayerAccountV2>();
  let degraded = !keys;
  let mutationQueue = Promise.resolve();

  const rebuildIndexes = (accounts: PlayerAccountV2[]) => {
    byId.clear();
    byEmailHash.clear();
    byNickname.clear();
    for (const account of accounts) {
      if (byId.has(account.playerId)) throw new Error("duplicate playerId");
      byId.set(account.playerId, account);
      if (account.status === "deleted") continue;
      if (!account.emailLookupHash || !account.nicknameNormalized) throw new Error("active account identifiers missing");
      if (byEmailHash.has(account.emailLookupHash)) throw new Error("duplicate account email");
      if (byNickname.has(account.nicknameNormalized)) throw new Error("duplicate account nickname");
      byEmailHash.set(account.emailLookupHash, account);
      byNickname.set(account.nicknameNormalized, account);
    }
  };

  const load = () => {
    if (!keys) {
      console.warn(JSON.stringify({ event: "accounts:key_unavailable" }));
      return;
    }
    if (!fs.existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AccountsFileV2>;
      if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.accounts)) {
        throw new Error("unsupported accounts schema; rebuild the development account store as documented");
      }
      for (const account of parsed.accounts) {
        if (!isAccount(account)) throw new Error("invalid account record");
        if (account.status !== "deleted") {
          const email = decryptEmail(keys, account);
          if (emailLookupHash(keys, email) !== account.emailLookupHash) throw new Error("account email index mismatch");
        }
      }
      rebuildIndexes(parsed.accounts);
    } catch (error) {
      degraded = true;
      byId.clear();
      byEmailHash.clear();
      byNickname.clear();
      console.warn(JSON.stringify({ event: "accounts:load_failed", error: String(error) }));
    }
  };

  load();

  const persist = (accounts: PlayerAccountV2[], redactBackup = false) => {
    if (degraded) throw new Error("account store unavailable");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const backupPath = `${filePath}.bak`;
    const backupTmpPath = `${backupPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const body = `${JSON.stringify({ schemaVersion: 2, accounts } satisfies AccountsFileV2, null, 2)}\n`;
    try {
      fs.writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600 });
      if (redactBackup) {
        // 软删除不能让应用级备份继续保留已清除的邮箱密文和密码摘要。
        // 先准备并替换备份，最后一步才替换主文件；这样任何报错都不会
        // 出现“主文件已提交、内存索引仍是旧值”的分裂状态。
        fs.writeFileSync(backupTmpPath, body, { encoding: "utf8", mode: 0o600 });
        fs.renameSync(backupTmpPath, backupPath);
      } else if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
      }
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      degraded = true;
      for (const pendingPath of [tmpPath, backupTmpPath]) {
        try {
          if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
        } catch {
          // 保留原始持久化错误；临时文件清理失败不覆盖主错误。
        }
      }
      throw error;
    }
  };

  const commit = (nextAccounts: PlayerAccountV2[], redactBackup = false) => {
    persist(nextAccounts, redactBackup);
    rebuildIndexes(nextAccounts);
  };

  const serial = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const profileOf = (account: PlayerAccountV2): AccountProfile | null => {
    if (!keys) return null;
    const identity = identityOf(account);
    if (!identity) return null;
    return { ...identity, email: decryptEmail(keys, account) };
  };

  const replaceAccount = (next: PlayerAccountV2, redactBackup = false) => {
    const accounts = [...byId.values()].map((account) => (account.playerId === next.playerId ? next : account));
    commit(accounts, redactBackup);
  };

  const updateProfile = (playerId: string, input: { nickname: string; avatar?: string | null }) =>
    serial(() => {
      if (degraded) return { ok: false, reason: "store_unavailable" } as const;
      const account = byId.get(playerId);
      if (!account || account.status !== "active") return { ok: false, reason: "not_found" } as const;
      const normalized = normalizeNickname(input.nickname);
      const owner = byNickname.get(normalized);
      if (owner && owner.playerId !== playerId) return { ok: false, reason: "nickname_unavailable" } as const;

      const nextNickname = input.nickname.trim().normalize("NFKC");
      const nicknameChanged = nextNickname !== account.nickname;
      const nextAvatar = input.avatar === undefined ? account.avatar : input.avatar;
      const avatarChanged = nextAvatar !== account.avatar;
      if (!nicknameChanged && !avatarChanged) {
        return { ok: true, account: profileOf(account)! } as const;
      }

      const now = Date.now();
      const next: PlayerAccountV2 = {
        ...account,
        nickname: nextNickname,
        nicknameNormalized: normalized,
        avatar: nextAvatar,
        nicknameChangedAt: nicknameChanged ? now : account.nicknameChangedAt,
        updatedAt: now
      };
      try {
        replaceAccount(next);
        return { ok: true, account: profileOf(next)! } as const;
      } catch {
        return { ok: false, reason: "store_unavailable" } as const;
      }
    });

  return {
    async register({ email, password, nickname, avatar = null }) {
      if (degraded || !keys) return { ok: false, reason: "store_unavailable" };
      const normalizedEmail = normalizeEmail(email);
      const normalizedNickname = normalizeNickname(nickname);
      const lookupHash = emailLookupHash(keys, normalizedEmail);
      const salt = crypto.randomBytes(16);
      const passwordHash = await hashPassword(password, salt, CURRENT_KDF);

      return serial(() => {
        if (degraded) return { ok: false, reason: "store_unavailable" } as const;
        if (byEmailHash.has(lookupHash)) return { ok: false, reason: "email_taken" } as const;
        if (byNickname.has(normalizedNickname)) return { ok: false, reason: "nickname_unavailable" } as const;
        const now = Date.now();
        const encrypted = encryptEmail(keys, normalizedEmail);
        const account: PlayerAccountV2 = {
          playerId: crypto.randomBytes(16).toString("base64url"),
          nickname: nickname.trim().normalize("NFKC"),
          nicknameNormalized: normalizedNickname,
          avatar,
          emailLookupHash: lookupHash,
          ...encrypted,
          emailKeyVersion: EMAIL_KEY_VERSION,
          passwordSalt: salt.toString("base64"),
          passwordHash: passwordHash.toString("base64"),
          kdf: { ...CURRENT_KDF },
          credentialVersion: 1,
          status: "active",
          createdAt: now,
          updatedAt: now,
          nicknameChangedAt: null,
          passwordChangedAt: now,
          deletedAt: null
        };
        try {
          commit([...byId.values(), account]);
          return { ok: true, account: profileOf(account)! } as const;
        } catch {
          return { ok: false, reason: "store_unavailable" } as const;
        }
      });
    },

    async authenticate({ email, password }) {
      if (degraded || !keys) return { ok: false, reason: "store_unavailable" };
      const account = byEmailHash.get(emailLookupHash(keys, normalizeEmail(email)));
      if (!account || account.status !== "active") {
        // 不存在与停用账号也执行同成本 KDF，避免通过响应时间枚举 active 邮箱。
        await hashPassword(password, DUMMY_PASSWORD_SALT, CURRENT_KDF);
        return { ok: false, reason: "invalid_credentials" };
      }
      if (!(await passwordMatches(account, password))) {
        return { ok: false, reason: "invalid_credentials" };
      }
      const profile = profileOf(account);
      return profile ? { ok: true, account: profile } : { ok: false, reason: "invalid_credentials" };
    },

    async verifyPassword(playerId, password) {
      if (degraded) return { ok: false, reason: "store_unavailable" };
      const account = byId.get(playerId);
      if (!account || account.status !== "active" || !(await passwordMatches(account, password))) {
        return { ok: false, reason: "invalid_credentials" };
      }
      const profile = profileOf(account);
      return profile ? { ok: true, account: profile } : { ok: false, reason: "invalid_credentials" };
    },

    getByPlayerId(playerId) {
      const account = byId.get(playerId);
      return account ? identityOf(account) : null;
    },

    getProfile(playerId) {
      const account = byId.get(playerId);
      return account ? profileOf(account) : null;
    },

    updateProfile,

    async updateNickname(playerId, nickname) {
      return updateProfile(playerId, { nickname });
    },

    async changePassword(playerId, currentPassword, newPassword) {
      return serial(async () => {
        if (degraded) return { ok: false, reason: "store_unavailable" } as const;
        const account = byId.get(playerId);
        if (!account || account.status !== "active" || !(await passwordMatches(account, currentPassword))) {
          return { ok: false, reason: "invalid_credentials" } as const;
        }
        const salt = crypto.randomBytes(16);
        const passwordHash = await hashPassword(newPassword, salt, CURRENT_KDF);
        const now = Date.now();
        const next: PlayerAccountV2 = {
          ...account,
          passwordSalt: salt.toString("base64"),
          passwordHash: passwordHash.toString("base64"),
          kdf: { ...CURRENT_KDF },
          credentialVersion: account.credentialVersion + 1,
          passwordChangedAt: now,
          updatedAt: now
        };
        try {
          replaceAccount(next);
          return { ok: true, account: profileOf(next)! } as const;
        } catch {
          return { ok: false, reason: "store_unavailable" } as const;
        }
      });
    },

    async changeEmail(playerId, currentPassword, newEmail) {
      return serial(async () => {
        if (degraded || !keys) return { ok: false, reason: "store_unavailable" } as const;
        const account = byId.get(playerId);
        if (!account || account.status !== "active" || !(await passwordMatches(account, currentPassword))) {
          return { ok: false, reason: "invalid_credentials" } as const;
        }
        const normalizedEmail = normalizeEmail(newEmail);
        const lookupHash = emailLookupHash(keys, normalizedEmail);
        const owner = byEmailHash.get(lookupHash);
        if (owner && owner.playerId !== playerId) return { ok: false, reason: "email_taken" } as const;
        const now = Date.now();
        const next: PlayerAccountV2 = {
          ...account,
          emailLookupHash: lookupHash,
          ...encryptEmail(keys, normalizedEmail),
          emailKeyVersion: EMAIL_KEY_VERSION,
          credentialVersion: account.credentialVersion + 1,
          updatedAt: now
        };
        try {
          replaceAccount(next);
          return { ok: true, account: profileOf(next)! } as const;
        } catch {
          return { ok: false, reason: "store_unavailable" } as const;
        }
      });
    },

    listAccounts({ query = "", status = "all" } = {}) {
      if (degraded || !keys) return [];
      const needle = query.trim().normalize("NFKC").toLowerCase();
      return [...byId.values()]
        .filter((account) => status === "all" || account.status === status)
        .map((account): AdminAccountView & { searchEmail: string } => {
          const email = account.status === "deleted" ? "" : decryptEmail(keys, account);
          return {
            playerId: account.playerId,
            nickname: account.nickname,
            avatar: account.status === "deleted" ? null : account.avatar ?? defaultAvatarForPlayer(account.playerId),
            maskedEmail: email ? maskEmail(email) : null,
            emailVerified: false,
            status: account.status,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            passwordChangedAt: account.passwordChangedAt,
            deletedAt: account.deletedAt,
            searchEmail: email.toLowerCase()
          };
        })
        .filter(
          (account) =>
            !needle ||
            account.playerId.toLowerCase().includes(needle) ||
            account.nickname?.toLowerCase().includes(needle) ||
            account.searchEmail.includes(needle)
        )
        .map(({ searchEmail: _searchEmail, ...account }) => account)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async setStatus(playerId, status) {
      return serial(() => {
        if (degraded) return { ok: false, reason: "store_unavailable" } as const;
        const account = byId.get(playerId);
        if (!account || account.status === "deleted") return { ok: false, reason: "not_found" } as const;
        if (account.status === status) return { ok: true, account: profileOf(account)! } as const;
        const now = Date.now();
        const next: PlayerAccountV2 = {
          ...account,
          status,
          credentialVersion: account.credentialVersion + 1,
          updatedAt: now
        };
        try {
          replaceAccount(next);
          return { ok: true, account: profileOf(next)! } as const;
        } catch {
          return { ok: false, reason: "store_unavailable" } as const;
        }
      });
    },

    async softDelete(playerId) {
      return serial(() => {
        if (degraded) return { ok: false, reason: "store_unavailable" } as const;
        const account = byId.get(playerId);
        if (!account || account.status === "deleted") return { ok: false, reason: "not_found" } as const;
        const now = Date.now();
        const tombstone: PlayerAccountV2 = {
          ...account,
          nickname: null,
          nicknameNormalized: null,
          avatar: null,
          emailLookupHash: null,
          emailCiphertext: null,
          emailIv: null,
          emailAuthTag: null,
          passwordSalt: null,
          passwordHash: null,
          kdf: null,
          credentialVersion: account.credentialVersion + 1,
          status: "deleted",
          updatedAt: now,
          deletedAt: now
        };
        try {
          replaceAccount(tombstone, true);
          return { ok: true } as const;
        } catch {
          return { ok: false, reason: "store_unavailable" } as const;
        }
      });
    },

    appendAdminAudit(entry) {
      try {
        fs.mkdirSync(path.dirname(auditPath), { recursive: true });
        fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
        return true;
      } catch (error) {
        // stdout 是 Railway 的第二审计落点；即使 JSONL 不可写，也保留完整、无敏感字段的动作记录。
        console.warn(JSON.stringify({ event: "accounts:audit_write_failed", error: String(error), audit: entry }));
        return false;
      }
    },

    isAvailable() {
      return !degraded;
    }
  };
};
