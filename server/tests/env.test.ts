import { describe, expect, it } from "vitest";
import { assertTlsVerificationEnabled } from "../src/env.js";

describe("TLS environment guard", () => {
  it("rejects disabled certificate verification in production", () => {
    expect(() =>
      assertTlsVerificationEnabled({ NODE_ENV: "production", NODE_TLS_REJECT_UNAUTHORIZED: "0" })
    ).toThrow("生产环境禁止设置 NODE_TLS_REJECT_UNAUTHORIZED=0");
  });

  it("allows normal production TLS and local development", () => {
    expect(() => assertTlsVerificationEnabled({ NODE_ENV: "production" })).not.toThrow();
    expect(() =>
      assertTlsVerificationEnabled({ NODE_ENV: "development", NODE_TLS_REJECT_UNAUTHORIZED: "0" })
    ).not.toThrow();
  });
});
