import { describe, expect, it } from "vitest";
import type { ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import { AgentStrategyPlanner } from "../src/agent/strategyPlanner.js";
import { buildDiscussionView } from "../src/agent/views.js";
import { appendChatMessage } from "../src/game/chat.js";
import { enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeRoom = () => {
  const room = createGameRoom(progress, 4);
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  return room;
};

const withExplicitAgreement = (
  view: ReturnType<typeof buildDiscussionView>,
  messageId: string
): ReturnType<typeof buildDiscussionView> => ({
  ...view,
  publicFacts: [
    {
      id: `fact-${messageId}`,
      entityType: "commitment",
      entityId: "agreement",
      attribute: "承诺",
      value: "明确公开约定",
      certainty: "explicit",
      sourceObservationIds: [`obs-${messageId}`],
      sourceMessageIds: [messageId]
    }
  ]
});

describe("AgentStrategyPlanner", () => {
  it("sends the strategy output contract and AbortSignal to the provider", async () => {
    const room = makeRoom();
    let captured: Parameters<MockModelClient["complete"]>[0] | undefined;
    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async (request) => {
        captured = request;
        return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
      })
    });
    const controller = new AbortController();

    await planner.compileForSeat("B", buildDiscussionView(room, "B"), { signal: controller.signal });

    expect(captured?.system).toContain("compile_seat_strategy");
    expect(captured?.signal).toBe(controller.signal);
    expect(captured?.attemptId).toBe(room.identity.attemptId);
  });

  it("compiles a per-seat proposal from valid model output without touching memory", async () => {
    const room = makeRoom();
    const message = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "B 你负责区6" });

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: [message.id]
            }
          ],
          privatePlan: ["优先把大牌留给区6"]
        })
      }))
    });

    const proposal = await planner.compileForSeat(
      "B",
      withExplicitAgreement(buildDiscussionView(room, "B"), message.id)
    );

    expect(proposal.rules).toHaveLength(1);
    expect(proposal.rules[0].strength).toBe("hard_commitment");
    expect(proposal.rules[0].sourceMessageIds).toEqual([message.id]);
    expect(proposal.privatePlan).toEqual(["优先把大牌留给区6"]);
  });

  it("downgrades hard commitments citing unknown messages to unresolved", async () => {
    const room = makeRoom();

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: ["message-that-does-not-exist"]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));

    expect(proposal.rules[0].strength).toBe("unresolved");
  });

  it("returns an empty proposal when the model output is invalid", async () => {
    const room = makeRoom();

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({ content: "这不是 JSON" }))
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));

    expect(proposal.rules).toHaveLength(0);
    expect(proposal.privatePlan).toHaveLength(0);
  });

  it("returns an empty proposal when the model call fails", async () => {
    const room = makeRoom();

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => {
        throw new Error("provider down");
      })
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));

    expect(proposal.rules).toHaveLength(0);
  });

  it("caps custom rules at suggestion because the server has no interpreter for them", async () => {
    const room = makeRoom();
    const message = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "大家都别放 7" });

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "custom",
              strength: "hard_commitment",
              targetSeatIds: [],
              parameters: { description: "所有人都不能打出 7" },
              sourceMessageIds: [message.id]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));

    expect(proposal.rules[0].strength).toBe("suggestion");
  });

  it("downgrades hard commitments citing only the agent's own messages to unresolved", async () => {
    const room = makeRoom();
    const ownMessage = appendChatMessage(room, { senderSeatId: "B", kind: "agent", nick: "AI-1", text: "我来负责区6" });

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: [ownMessage.id]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));

    expect(proposal.rules[0].strength).toBe("unresolved");
  });

  it("keeps hard commitments that trace to another participant's public message", async () => {
    const room = makeRoom();
    const ownMessage = appendChatMessage(room, { senderSeatId: "B", kind: "agent", nick: "AI-1", text: "我来负责区6" });
    const humanReply = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "好，就这么定" });

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: [ownMessage.id, humanReply.id]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const proposal = await planner.compileForSeat(
      "B",
      withExplicitAgreement(buildDiscussionView(room, "B"), humanReply.id)
    );

    expect(proposal.rules[0].strength).toBe("hard_commitment");
  });

  it("does not promote an arbitrary external chat message to a hard commitment", async () => {
    const room = makeRoom();
    const unrelated = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "大家好" });
    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: [unrelated.id]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const proposal = await planner.compileForSeat("B", buildDiscussionView(room, "B"));
    expect(proposal.rules[0].strength).toBe("unresolved");
  });

  it("downgrades rules citing conflicted entity facts to unresolved", async () => {
    const room = makeRoom();
    const humanMessage = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "区6 放大牌" });

    const planner = new AgentStrategyPlanner({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          rules: [
            {
              type: "segment_assignment",
              strength: "hard_commitment",
              targetSeatIds: ["B"],
              targetSegments: [5],
              parameters: {},
              sourceMessageIds: [humanMessage.id]
            }
          ],
          privatePlan: []
        })
      }))
    });

    const view = {
      ...buildDiscussionView(room, "B"),
      publicFacts: [
        {
          id: "fact-1",
          entityType: "commitment" as const,
          entityId: "seat:A",
          attribute: "承诺",
          value: "区6 放大牌",
          certainty: "conflicted" as const,
          sourceObservationIds: ["obs-1"],
          sourceMessageIds: [humanMessage.id]
        }
      ]
    };

    const proposal = await planner.compileForSeat("B", view);

    expect(proposal.rules[0].strength).toBe("unresolved");
  });

  it("produces independent proposals per seat", async () => {
    const room = makeRoom();
    const message = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "C 避开区1" });

    const plannerFor = (plan: string) =>
      new AgentStrategyPlanner({
        modelClient: new MockModelClient(async () => ({
          content: JSON.stringify({
            rules: [
              {
                type: "avoid_segment",
                strength: "strong_preference",
                targetSeatIds: [],
                targetSegments: [0],
                parameters: {},
                sourceMessageIds: [message.id]
              }
            ],
            privatePlan: [plan]
          })
        }))
      });

    const proposalB = await plannerFor("B 的计划").compileForSeat("B", buildDiscussionView(room, "B"));
    const proposalC = await plannerFor("C 的计划").compileForSeat("C", buildDiscussionView(room, "C"));

    expect(proposalB.privatePlan).toEqual(["B 的计划"]);
    expect(proposalC.privatePlan).toEqual(["C 的计划"]);
    expect(JSON.stringify(proposalB)).not.toContain("C 的计划");
  });
});
