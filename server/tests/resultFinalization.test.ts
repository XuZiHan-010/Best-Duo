import { describe, expect, it } from "vitest";
import type { Challenge, PlacedCard, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import { enterDiscussion } from "../src/game/phases.js";
import { failByPlayerLeft, failByTimeout, revealAndScore } from "../src/game/reveal.js";
import { createGameRoom } from "../src/game/room.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeChallenge = (id: string): Challenge => ({
  id,
  name: `测试关卡 ${id}`,
  levelIndex: 1,
  difficulty: "★",
  segmentCount: 6,
  centerCap: "inf",
  playable: true,
  conditions: [{ type: "all-nonempty" }]
});

const makePlacedCard = (id: string, owner: SeatId, value: number): PlacedCard => ({
  id,
  owner,
  value,
  color: "white",
  revealed: false,
  placedAt: Date.now(),
  playOrder: 1
});

const makeDiscussionRoom = (challenge: Challenge) => {
  const room = createGameRoom(structuredClone(progress), 4);
  room.phase = "levelSelect";
  enterDiscussion(room, challenge);
  return room;
};

describe("result finalization across all failure paths", () => {
  it("enriches a deterministic retry brief through the retry_brief model task", async () => {
    let retryCalled: (() => void) | undefined;
    const retryRequest = new Promise<void>((resolve) => {
      retryCalled = resolve;
    });
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.task === "retry_brief") {
          retryCalled?.();
          return {
            content: JSON.stringify({
              lessons: [{ description: "重试时先确认空区段", confidence: 0.9, sourceIds: [] }]
            })
          };
        }
        return { content: JSON.stringify({ message: "我会注意空区段", entities: [] }) };
      })
    });
    const room = makeDiscussionRoom(makeChallenge("level-x"));
    const agentSeat = room.seats.find((seat) => seat.id === "B")!;
    agentSeat.kind = "agent";
    agentSeat.nick = "AI-1";
    agentSeat.agentId = "agent-b";
    runtime.onDiscussionStarted(room);

    failByTimeout(room);
    const brief = runtime.onResult(room);
    await retryRequest;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(brief?.lessons).toEqual([
      { description: "重试时先确认空区段", confidence: 0.9, sourceIds: [] }
    ]);
  });

  it("generates a degraded retry brief with failureReason on timeout", () => {
    const runtime = new AgentRuntime();
    const challenge = makeChallenge("level-x");
    const room = makeDiscussionRoom(challenge);
    runtime.onDiscussionStarted(room);

    failByTimeout(room);
    const brief = runtime.onResult(room);

    expect(brief).not.toBeNull();
    expect(brief?.failureReason).toBe("timeout");
    expect(brief?.passedSegments).toEqual([]);
    expect(brief?.failedSegments).toEqual([]);
    expect(brief?.lessons).toHaveLength(1);
    expect(
      runtime.memory.currentAttempt()?.shared.observations.some(
        (observation) =>
          observation.type === "phase_changed" &&
          (observation.payload as { phase?: string }).phase === "result"
      )
    ).toBe(true);

    // 同关重试必须继承这次超时 attempt 的摘要，而不是更早的旧摘要。
    room.phase = "result";
    enterDiscussion(room, challenge);
    runtime.onDiscussionStarted(room);
    expect(runtime.memory.currentAttempt()?.shared.retryBriefInput?.failureReason).toBe("timeout");
  });

  it("generates a degraded retry brief with failureReason on player-left", () => {
    const runtime = new AgentRuntime();
    const room = makeDiscussionRoom(makeChallenge("level-x"));
    runtime.onDiscussionStarted(room);

    failByPlayerLeft(room);
    const brief = runtime.onResult(room);

    expect(brief?.failureReason).toBe("player-left");
  });

  it("labels a failed reveal brief with rule-unmet", () => {
    const runtime = new AgentRuntime();
    const room = makeDiscussionRoom(makeChallenge("level-x"));
    runtime.onDiscussionStarted(room);

    room.placements = Array.from({ length: 6 }, (_unused, index) =>
      index === 0 ? [] : [makePlacedCard(`card-${index}`, "A", index + 1)]
    );
    revealAndScore(room);
    expect(room.revealResult?.pass).toBe(false);

    const brief = runtime.onResult(room);
    expect(brief?.failureReason).toBe("rule-unmet");
  });

  it("attributes an all-nonempty failure to the empty segments", () => {
    const runtime = new AgentRuntime();
    const room = makeDiscussionRoom(makeChallenge("level-x"));
    runtime.onDiscussionStarted(room);

    room.placements = Array.from({ length: 6 }, (_unused, index) =>
      index === 0 ? [] : [makePlacedCard(`card-${index}`, "A", index + 1)]
    );
    revealAndScore(room);
    expect(room.revealResult?.pass).toBe(false);

    const brief = runtime.onResult(room);
    expect(brief?.failedSegments).toEqual([0]);
    expect(brief?.passedSegments).toEqual([1, 2, 3, 4, 5]);
  });

  it("attributes a max-sum-each failure to the segments over the cap", () => {
    const runtime = new AgentRuntime();
    const challenge: Challenge = {
      ...makeChallenge("level-cap"),
      conditions: [{ type: "max-sum-each", value: 10 }]
    };
    const room = makeDiscussionRoom(challenge);
    runtime.onDiscussionStarted(room);

    room.placements = Array.from({ length: 6 }, (_unused, index) =>
      index === 3
        ? [makePlacedCard("card-3a", "A", 5), makePlacedCard("card-3b", "B", 7)]
        : [makePlacedCard(`card-${index}`, "A", 2)]
    );
    revealAndScore(room);
    expect(room.revealResult?.pass).toBe(false);

    const brief = runtime.onResult(room);
    expect(brief?.failedSegments).toEqual([3]);
    expect(brief?.passedSegments).toEqual([0, 1, 2, 4, 5]);
  });

  it("finalizes an attempt at most once", () => {
    const runtime = new AgentRuntime();
    const challenge = makeChallenge("level-x");
    const room = makeDiscussionRoom(challenge);
    runtime.onDiscussionStarted(room);

    failByTimeout(room);
    const first = runtime.onResult(room);
    const second = runtime.onResult(room);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
