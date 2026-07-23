import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountRateLimiter, ActionRateLimiter } from "../src/auth/accountRateLimit.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("account rate limit bucket lifecycle", () => {
  it("失败限流桶达到硬上限时淘汰最旧项，并在窗口后过期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const limiter = new AccountRateLimiter(1, 100, 2);

    limiter.fail("a");
    limiter.fail("b");
    limiter.fail("c");
    expect(limiter.blocked("a")).toBe(false);

    vi.setSystemTime(1_101);
    expect(limiter.blocked("c")).toBe(false);
  });

  it("动作限流桶达到硬上限时淘汰最旧项，并在窗口后过期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const limiter = new ActionRateLimiter(1, 100, 2);

    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.take("c")).toBe(true);
    expect(limiter.take("a")).toBe(true);

    vi.setSystemTime(2_101);
    expect(limiter.take("c")).toBe(true);
  });
});
