import { describe, expect, it } from "vitest";
import { loadAgentProviderConfig, maxOutputTokensFor } from "../src/agent/providerConfig.js";

describe("loadAgentProviderConfig", () => {
  it("returns no routes when no api key is configured", () => {
    const config = loadAgentProviderConfig({});
    expect(config.routes).toEqual({});
  });

  it("only enables tasks whose provider key is present", () => {
    const config = loadAgentProviderConfig({ OPENAI_API_KEY: "sk-test" });
    expect(config.routes.turn).toEqual({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      maxOutputTokens: 2_000,
      reasoningEffort: "none"
    });
    expect(config.routes.discussion).toEqual({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
      maxOutputTokens: 4_000,
      reasoningEffort: "low"
    });
    // retry_brief 默认走 deepseek，没配 key 时保持未配置。
    expect(config.routes.retry_brief).toBeUndefined();
  });

  it("uses deepseek flash defaults for retry_brief only", () => {
    const config = loadAgentProviderConfig({ DEEPSEEK_API_KEY: "ds-test" });
    expect(config.routes.retry_brief).toEqual({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "ds-test",
      model: "deepseek-v4-flash",
      maxOutputTokens: 2_000
    });
    // discussion / turn 默认走 openai，没配 key 时保持未配置。
    expect(config.routes.discussion).toBeUndefined();
    expect(config.routes.turn).toBeUndefined();
  });

  it("honors provider, base url and model overrides per task", () => {
    const config = loadAgentProviderConfig({
      DEEPSEEK_API_KEY: "ds-test",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://proxy.example.com/v1",
      AGENT_DISCUSSION_PROVIDER: "deepseek",
      AGENT_DISCUSSION_MODEL: "deepseek-v4-pro",
      AGENT_TURN_MODEL: "gpt-5.4-nano"
    });
    expect(config.routes.discussion).toEqual({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "ds-test",
      model: "deepseek-v4-pro",
      maxOutputTokens: 4_000,
      reasoningEffort: "low"
    });
    expect(config.routes.turn?.model).toBe("gpt-5.4-nano");
    expect(config.routes.turn?.baseURL).toBe("https://proxy.example.com/v1");
  });

  it("honors task-specific key, base URL, token and reasoning overrides", () => {
    const config = loadAgentProviderConfig({
      AGENT_TURN_API_KEY: "task-key",
      AGENT_TURN_BASE_URL: "https://turn.example.com/v1",
      AGENT_TURN_MAX_OUTPUT_TOKENS: "321",
      AGENT_TURN_REASONING_EFFORT: "none"
    });
    expect(config.routes.turn).toMatchObject({
      apiKey: "task-key",
      baseURL: "https://turn.example.com/v1",
      maxOutputTokens: 321,
      reasoningEffort: "none"
    });
  });

  it("ignores invalid provider overrides and falls back to task defaults", () => {
    const config = loadAgentProviderConfig({
      OPENAI_API_KEY: "sk-test",
      AGENT_TURN_PROVIDER: "anthropic"
    });
    expect(config.routes.turn?.provider).toBe("openai");
  });

  it("maxOutputTokensFor reads env overrides and falls back to task defaults without any api key", () => {
    expect(maxOutputTokensFor("discussion", {})).toBe(4_000);
    expect(maxOutputTokensFor("turn", {})).toBe(2_000);
    expect(maxOutputTokensFor("retry_brief", {})).toBe(2_000);
    expect(maxOutputTokensFor("discussion", { AGENT_DISCUSSION_MAX_OUTPUT_TOKENS: "6000" })).toBe(6_000);
    expect(maxOutputTokensFor("discussion", { AGENT_DISCUSSION_MAX_OUTPUT_TOKENS: "not-a-number" })).toBe(4_000);
  });

  it("parses budget overrides and rejects invalid values", () => {
    const config = loadAgentProviderConfig({
      AGENT_ATTEMPT_MAX_CALLS: "10",
      AGENT_ATTEMPT_MAX_TOKENS: "-5",
      AGENT_DAILY_MAX_CALLS: "not-a-number"
    });
    expect(config.budget.attemptMaxCalls).toBe(10);
    expect(config.budget.attemptMaxTokens).toBe(200_000);
    expect(config.budget.dailyMaxCalls).toBe(500);
    expect(config.budget.dailyMaxTokens).toBe(2_000_000);
  });
});
