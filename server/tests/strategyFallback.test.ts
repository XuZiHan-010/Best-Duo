import { describe, expect, it } from "vitest";
import type { ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import { createGameRoom } from "../src/game/room.js";
import { enterDiscussion } from "../src/game/phases.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const levels = loadLevels();

const hangingModelClient = () =>
  new MockModelClient(
    (request) =>
      new Promise((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
  );

const setupRoomWithAgent = () => {
  const room = createGameRoom(structuredClone(progress), levels);
  const seatC = room.seats.find((seat) => seat.id === "C")!;
  Object.assign(seatC, { kind: "agent", nick: "AI-1", agentId: "agent-c", connected: true });
  room.phase = "levelSelect";
  enterDiscussion(room, levels[0]);
  return room;
};

// 收口失败不得伪装成成功的空策略：策略必须带明确的 source 与 compileOutcome，
// 且讨论已有明确公开约定时，从公开事实派生确定性兜底规则
// （见 plans/2026-07-21-agent-discussion-and-placement-findings.md P0-2）。
describe("strategy compile fallback", () => {
  it("locks an 'unavailable' strategy when compile times out with no public facts", async () => {
    const runtime = new AgentRuntime({
      strategyDeadlineMs: 20,
      modelClient: hangingModelClient(),
      discussion: { cooldownMs: 0, delay: async () => {} }
    });
    const room = setupRoomWithAgent();
    runtime.onDiscussionStarted(room);

    await runtime.finalizeDiscussion(room);

    expect(runtime.memory.strategyFor("C")).toMatchObject({
      status: "locked",
      rules: [],
      source: "unavailable",
      compileOutcome: "timeout"
    });
  });

  it("locks a public-facts fallback strategy when compile times out but explicit facts exist", async () => {
    const runtime = new AgentRuntime({
      strategyDeadlineMs: 20,
      modelClient: hangingModelClient(),
      discussion: { cooldownMs: 0, delay: async () => {} }
    });
    const room = setupRoomWithAgent();
    runtime.onDiscussionStarted(room);

    const attemptId = room.identity.attemptId!;
    const observation = runtime.memory.recordObservation({
      attemptId,
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { messageId: "msg-1", text: "区1只放最小的白牌" }
    });
    runtime.memory.upsertFact({
      entityType: "segment",
      entityId: "0",
      attribute: "assignment",
      value: "最小白牌",
      certainty: "explicit",
      sourceObservationIds: [observation.id]
    });

    await runtime.finalizeDiscussion(room);

    const strategy = runtime.memory.strategyFor("C");
    expect(strategy).toMatchObject({ status: "locked", source: "public_facts_fallback", compileOutcome: "timeout" });
    expect(strategy?.rules.length ?? 0).toBeGreaterThan(0);
    // 兜底规则必须可追溯到公开消息来源。
    expect(strategy?.rules[0]?.sourceMessageIds).toContain("msg-1");
  });

  it("keeps source 'model' and outcome 'ok' on a successful compile", async () => {
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return {
            content: JSON.stringify({
              rules: [
                {
                  type: "segment_assignment",
                  strength: "suggestion",
                  targetSeatIds: ["C"],
                  targetSegments: [5],
                  parameters: {},
                  sourceMessageIds: []
                }
              ],
              privatePlan: ["区6收大牌"]
            })
          };
        }
        return { content: JSON.stringify({ action: "wait", reason: "no_substantive_input" }) };
      }),
      discussion: { cooldownMs: 0, delay: async () => {} }
    });
    const room = setupRoomWithAgent();
    runtime.onDiscussionStarted(room);

    await runtime.finalizeDiscussion(room);

    expect(runtime.memory.strategyFor("C")).toMatchObject({
      status: "locked",
      source: "model",
      compileOutcome: "ok"
    });
  });
});
