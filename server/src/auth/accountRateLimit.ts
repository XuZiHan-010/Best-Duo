import { FailureRateLimiter } from "./adminAuth.js";

// 账号认证失败限流：调用方可按邮箱登录标识或 playerId 分桶。
export class AccountRateLimiter {
  private limiters = new Map<string, { limiter: FailureRateLimiter; lastSeenAt: number }>();
  private lastSweepAt = 0;

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000,
    private readonly maxBuckets = 10_000
  ) {}

  private prune(now: number, force = false): void {
    if (!force && now - this.lastSweepAt < this.windowMs) return;
    this.lastSweepAt = now;
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.limiters) {
      if (bucket.lastSeenAt <= cutoff) this.limiters.delete(key);
    }
  }

  private limiterFor(key: string): FailureRateLimiter {
    const now = Date.now();
    this.prune(now, !this.limiters.has(key) && this.limiters.size >= Math.max(1, this.maxBuckets));
    let bucket = this.limiters.get(key);
    if (!bucket) {
      while (this.limiters.size >= Math.max(1, this.maxBuckets)) {
        const oldestKey = this.limiters.keys().next().value as string | undefined;
        if (!oldestKey) break;
        this.limiters.delete(oldestKey);
      }
      bucket = { limiter: new FailureRateLimiter(this.maxFailures, this.windowMs), lastSeenAt: now };
      this.limiters.set(key, bucket);
    } else {
      bucket.lastSeenAt = now;
      // Map 插入顺序同时作为近似 LRU；刷新活跃桶，达到硬上限时优先淘汰最旧桶。
      this.limiters.delete(key);
      this.limiters.set(key, bucket);
    }
    return bucket.limiter;
  }

  blocked(key: string): boolean {
    return this.limiterFor(key).blocked();
  }

  fail(key: string): void {
    this.limiterFor(key).fail();
  }

  reset(key: string): void {
    this.limiters.delete(key);
  }
}

/** 对成功与失败操作都计数，覆盖注册、换邮和管理员写操作等高风险入口。 */
export class ActionRateLimiter {
  private attempts = new Map<string, number[]>();
  private lastSweepAt = 0;

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 60_000,
    private readonly maxBuckets = 10_000
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const needsCapacity = !this.attempts.has(key) && this.attempts.size >= Math.max(1, this.maxBuckets);
    if (now - this.lastSweepAt >= this.windowMs || needsCapacity) {
      this.lastSweepAt = now;
      for (const [candidateKey, timestamps] of this.attempts) {
        const active = timestamps.filter((at) => at > cutoff);
        if (active.length === 0) this.attempts.delete(candidateKey);
        else this.attempts.set(candidateKey, active);
      }
    }
    while (!this.attempts.has(key) && this.attempts.size >= Math.max(1, this.maxBuckets)) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.attempts.delete(oldestKey);
    }
    const recent = (this.attempts.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }
}
