import { describe, expect, it } from "vitest";
import { MockModelClient } from "../src/agent/modelClient.js";
import {
  OpenAICompatModelClient,
  RoutingModelClient,
  createModelClientFromConfig,
  type ChatCompletionsClient
} from "../src/agent/providers.js";
import type { TaskModelRoute } from "../src/agent/providerConfig.js";

const route: TaskModelRoute = {
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
  apiKey: "ds-test",
  model: "deepseek-v4-pro",
  maxOutputTokens: 1_200
};

interface CapturedCall {
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format?: { type: string };
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: string;
  };
  options?: { signal?: AbortSignal };
}

const fakeChatClient = (
  respond: () => Promise<{
    choices: Array<{ message?: { content?: string | null } | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  }>
) => {
  const calls: CapturedCall[] = [];
  const client: ChatCompletionsClient = {
    chat: {
      completions: {
        create: (body, options) => {
          calls.push({ body, options });
          return respond();
        }
      }
    }
  };
  return { client, calls };
};

describe("OpenAICompatModelClient", () => {
  it("maps system/prompt to chat messages with json response format and returns usage", async () => {
    const { client, calls } = fakeChatClient(async () => ({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 }
    }));
    const modelClient = new OpenAICompatModelClient(route, client);

    const controller = new AbortController();
    const response = await modelClient.complete({
      task: "turn",
      system: "系统指令",
      prompt: '{"view":1}',
      signal: controller.signal
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.model).toBe("deepseek-v4-pro");
    expect(calls[0]?.body.messages).toEqual([
      { role: "system", content: "系统指令" },
      { role: "user", content: '{"view":1}' }
    ]);
    expect(calls[0]?.body.response_format).toEqual({ type: "json_object" });
    expect(calls[0]?.body.max_tokens).toBe(1_200);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
    expect(response.content).toBe('{"ok":true}');
    expect(response.tokensIn).toBe(120);
    expect(response.tokensOut).toBe(30);
    expect(typeof response.latencyMs).toBe("number");
  });

  it("uses OpenAI reasoning effort and completion token controls", async () => {
    const { client, calls } = fakeChatClient(async () => ({ choices: [{ message: { content: "{}" } }] }));
    const openaiRoute: TaskModelRoute = {
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      maxOutputTokens: 500,
      reasoningEffort: "low"
    };

    await new OpenAICompatModelClient(openaiRoute, client).complete({ task: "turn", prompt: "p" });

    expect(calls[0]?.body.max_completion_tokens).toBe(500);
    expect(calls[0]?.body.reasoning_effort).toBe("low");
    expect(calls[0]?.body.max_tokens).toBeUndefined();
  });

  it("sends reasoning effort on the deepseek branch and lets request-level effort win", async () => {
    const { client, calls } = fakeChatClient(async () => ({ choices: [{ message: { content: "{}" } }] }));
    const dsRoute: TaskModelRoute = { ...route, reasoningEffort: "medium" };

    await new OpenAICompatModelClient(dsRoute, client).complete({
      task: "discussion",
      prompt: "p",
      reasoningEffort: "low"
    });

    // 请求级档位覆盖 route 配置；DeepSeek 分支同样携带 reasoning_effort（此前被静默丢弃）。
    expect(calls[0]?.body.reasoning_effort).toBe("low");
    expect(calls[0]?.body.max_tokens).toBe(1_200);
    expect(calls[0]?.body.max_completion_tokens).toBeUndefined();
  });

  it("omits the system message when not provided", async () => {
    const { client, calls } = fakeChatClient(async () => ({
      choices: [{ message: { content: "{}" } }]
    }));
    await new OpenAICompatModelClient(route, client).complete({ task: "turn", prompt: "p" });
    expect(calls[0]?.body.messages).toEqual([{ role: "user", content: "p" }]);
  });

  it("returns an empty response so the schema layer can classify it as illegal output", async () => {
    const { client } = fakeChatClient(async () => ({ choices: [{ message: { content: null } }] }));
    await expect(new OpenAICompatModelClient(route, client).complete({ task: "turn", prompt: "p" })).resolves.toMatchObject({
      content: ""
    });
  });
});

describe("RoutingModelClient", () => {
  it("routes requests by task and rejects unconfigured tasks", async () => {
    const seen: string[] = [];
    const clientFor = (name: string) =>
      new MockModelClient(async () => {
        seen.push(name);
        return { content: "{}" };
      });

    const routing = new RoutingModelClient({ turn: clientFor("turn-client") });

    await routing.complete({ task: "turn", prompt: "p" });
    expect(seen).toEqual(["turn-client"]);
    await expect(routing.complete({ task: "discussion", prompt: "p" })).rejects.toThrow(/未配置/);
  });
});

describe("createModelClientFromConfig", () => {
  it("returns null when no task route is configured", () => {
    expect(createModelClientFromConfig({ routes: {}, budget: { attemptMaxCalls: 1, attemptMaxTokens: 1, dailyMaxCalls: 1, dailyMaxTokens: 1 } })).toBeNull();
  });

  it("builds one client per configured route via the factory", async () => {
    const created: string[] = [];
    const client = createModelClientFromConfig(
      {
        routes: { turn: route, discussion: { ...route, provider: "openai" } },
        budget: { attemptMaxCalls: 1, attemptMaxTokens: 1, dailyMaxCalls: 1, dailyMaxTokens: 1 }
      },
      (taskRoute) => {
        created.push(taskRoute.provider);
        return new MockModelClient(async () => ({ content: taskRoute.provider }));
      }
    );

    expect(created.sort()).toEqual(["deepseek", "openai"]);
    await expect(client?.complete({ task: "turn", prompt: "p" })).resolves.toEqual({ content: "deepseek" });
    await expect(client?.complete({ task: "discussion", prompt: "p" })).resolves.toEqual({ content: "openai" });
  });
});
