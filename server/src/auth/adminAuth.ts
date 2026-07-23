import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

// 先哈希再比较：长度归一化后 timingSafeEqual 恒定时间，防时序侧信道。
const digest = (value: string) => createHash("sha256").update(value).digest();
const safeEquals = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export const isAdminConfigured = (): boolean =>
  config.adminUsername.length > 0 &&
  config.adminPassword.length > 0 &&
  config.adminPassword !== config.roomPassword;

export const verifyAdminCredentials = (username: string, password: string): boolean => {
  if (!isAdminConfigured()) return false;
  const userOk = safeEquals(username, config.adminUsername);
  const passOk = safeEquals(password, config.adminPassword);
  return userOk && passOk;
};

// 简单内存滑动窗口限流：窗口内失败次数达到上限即拒绝后续尝试。
export class FailureRateLimiter {
  private failures: number[] = [];

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000
  ) {}

  blocked(): boolean {
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter((t) => t > cutoff);
    return this.failures.length >= this.maxFailures;
  }

  fail(): void {
    this.failures.push(Date.now());
  }

  reset(): void {
    this.failures = [];
  }
}
