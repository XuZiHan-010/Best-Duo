import { FailureRateLimiter } from "./adminAuth.js";

// 账号密码失败限流：按昵称维度的 60 秒滑动窗口（复用管理员限流的窗口实现）。
// 成功登录即清除该昵称的失败记录，防止攻击者用错误尝试锁死合法昵称后仍长期占用内存。
export class AccountRateLimiter {
  private limiters = new Map<string, FailureRateLimiter>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000
  ) {}

  private limiterFor(nick: string): FailureRateLimiter {
    let limiter = this.limiters.get(nick);
    if (!limiter) {
      limiter = new FailureRateLimiter(this.maxFailures, this.windowMs);
      this.limiters.set(nick, limiter);
    }
    return limiter;
  }

  blocked(nick: string): boolean {
    return this.limiterFor(nick).blocked();
  }

  fail(nick: string): void {
    this.limiterFor(nick).fail();
  }

  reset(nick: string): void {
    this.limiters.delete(nick);
  }
}
