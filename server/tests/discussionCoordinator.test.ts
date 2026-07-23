import { describe, expect, it } from "vitest";
import type { ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { DiscussionCoordinator, type DiscussionSpeaker } from "../src/agent/discussionCoordinator.js";
import { enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { appendChatMessage } from "../src/game/chat.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeDiscussionRoom = () => {
  const room = createGameRoom(progress, 4);
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "测试讨论" });
  return room;
};

const instantDelay = async () => {};

const speakerOf = (seatId: SeatId, texts: Array<string | null>): DiscussionSpeaker => {
  let callIndex = 0;
  return {
    seatId,
    async decideDiscussion(view) {
      const text = texts[Math.min(callIndex, texts.length - 1)];
      callIndex += 1;
      const focusMessage = [...view.chat].reverse().find((message) => message.kind === "human");
      return text && focusMessage
        ? { action: "speak", replyToMessageId: focusMessage.id, message: text, entities: [] }
        : null;
    }
  };
};

describe("DiscussionCoordinator", () => {
  it("lets agents speak in order and respects the per-agent message cap", async () => {
    const room = makeDiscussionRoom();
    const spoken: Array<{ seatId: SeatId; message: string }> = [];

    const coordinator = new DiscussionCoordinator(room, [speakerOf("B", ["B1", "B2", "B3"]), speakerOf("C", ["C1", "C2", "C3"])], {
      maxMessagesPerAgent: 2,
      cooldownMs: 0,
      delay: instantDelay,
      onMessage: (seatId, message) => spoken.push({ seatId, message })
    });

    await coordinator.start();

    expect(spoken).toEqual([
      { seatId: "B", message: "B1" },
      { seatId: "C", message: "C1" },
      { seatId: "B", message: "B2" },
      { seatId: "C", message: "C2" }
    ]);
  });

  // 回归：focusMessage 取自已排除过滤的视图，聚焦对照必须用同一份排除集。
  // 否则一条消息被 guard 排除后两边永远对不上，模型回复会被无条件丢弃、白烧调用。
  it("grounds the focus check on the same exclusion set the view uses", async () => {
    const room = makeDiscussionRoom();
    const blocked = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "被拦截的无关问题"
    });
    const spoken: string[] = [];

    const coordinator = new DiscussionCoordinator(room, [speakerOf("B", ["B1"])], {
      maxMessagesPerAgent: 1,
      cooldownMs: 0,
      delay: instantDelay,
      excludedMessageIds: () => new Set([blocked.id]),
      onMessage: (_seatId, message) => spoken.push(message)
    });

    await coordinator.start();

    expect(spoken).toEqual(["B1"]);
  });

  it("fires onSpeakerExhausted exactly once when a seat hits the failure cap", async () => {
    const room = makeDiscussionRoom();
    const exhausted: SeatId[] = [];
    const failingSpeaker: DiscussionSpeaker = {
      seatId: "B",
      async decideDiscussion() {
        return null;
      }
    };

    const coordinator = new DiscussionCoordinator(room, [failingSpeaker], {
      maxMessagesPerAgent: 5,
      maxConsecutiveFailures: 3,
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: () => {},
      onSpeakerExhausted: (seatId) => exhausted.push(seatId)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.notifyActivity();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.notifyActivity();
    await running;

    // 恰好在跨过阈值那一刻触发一次，不重复。
    expect(exhausted).toEqual(["B"]);
  });

  it("reports the model's off-topic verdict against the focused human message", async () => {
    const room = makeDiscussionRoom();
    const focus = room.chat.at(-1)!;
    const verdicts: Array<{ focusMessageId: string; topic: string }> = [];

    const decliner: DiscussionSpeaker = {
      seatId: "B",
      async decideDiscussion() {
        return {
          action: "decline_off_topic",
          replyToMessageId: focus.id,
          message: "这个和本局无关。"
        };
      }
    };

    const coordinator = new DiscussionCoordinator(room, [decliner], {
      maxMessagesPerAgent: 1,
      cooldownMs: 0,
      delay: instantDelay,
      onMessage: (_seatId, _message, entities, verdict) => {
        // 拒答不携带实体，避免把无关文本写进记忆。
        expect(entities).toBeUndefined();
        if (verdict) verdicts.push(verdict);
      }
    });

    await coordinator.start();

    expect(verdicts).toEqual([{ focusMessageId: focus.id, topic: "off_topic" }]);
  });

  it("stops when every agent declines to speak in a full round", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];

    const coordinator = new DiscussionCoordinator(room, [speakerOf("B", ["B1", null]), speakerOf("C", [null])], {
      maxMessagesPerAgent: 5,
      cooldownMs: 0,
      delay: instantDelay,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    await coordinator.start();

    expect(spoken).toEqual(["B1"]);
  });

  it("stops retrying a seat after consecutive failures reach the cap", async () => {
    const room = makeDiscussionRoom();
    let calls = 0;
    const failingSpeaker: DiscussionSpeaker = {
      seatId: "B",
      async decideDiscussion() {
        calls += 1;
        return null;
      }
    };

    const coordinator = new DiscussionCoordinator(room, [failingSpeaker], {
      maxMessagesPerAgent: 5,
      maxConsecutiveFailures: 3,
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: () => {
        throw new Error("失败座位不应产生发言");
      }
    });

    const running = coordinator.start();
    // 每条真人消息唤醒一轮重试；三次连续失败后座位耗尽，协调器自然结束而不是继续烧调用。
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.notifyActivity();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.notifyActivity();
    await running;

    expect(calls).toBe(3);
  });

  it("wakes after a later human activity instead of ending the production discussion", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];
    const coordinator = new DiscussionCoordinator(room, [speakerOf("B", [null, "收到后到消息"])], {
      maxMessagesPerAgent: 1,
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spoken).toEqual([]);

    coordinator.notifyActivity();
    await running;
    expect(spoken).toEqual(["收到后到消息"]);
  });

  it("does not ask any agent to speak before the first human activity in production mode", async () => {
    const room = makeDiscussionRoom();
    let calls = 0;
    const coordinator = new DiscussionCoordinator(
      room,
      [
        {
          seatId: "B",
          async decideDiscussion() {
            calls += 1;
            return { action: "wait", reason: "no_substantive_input" } as const;
          }
        }
      ],
      {
        maxMessagesPerAgent: 1,
        cooldownMs: 0,
        delay: instantDelay,
        waitForActivity: true,
        waitForInitialActivity: true,
        onMessage: () => {
          throw new Error("等待决策不应产生发言");
        }
      }
    );

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(0);

    coordinator.notifyActivity();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);

    coordinator.cancel();
    await running;
  });

  it("waits for human activity between productive Agent rounds", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];
    const coordinator = new DiscussionCoordinator(room, [speakerOf("B", ["B1", "B2"])], {
      maxMessagesPerAgent: 2,
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spoken).toEqual(["B1"]);

    coordinator.notifyActivity();
    await running;
    expect(spoken).toEqual(["B1", "B2"]);
  });

  it("drops a reply when a newer human message arrives during model inference", async () => {
    const room = makeDiscussionRoom();
    const firstHuman = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "旧问题"
    });
    const spoken: string[] = [];
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    const speaker: DiscussionSpeaker = {
      seatId: "B",
      decideDiscussion: () => {
        calls += 1;
        if (calls > 1) return Promise.resolve({ action: "wait", reason: "nothing_new" });
        return new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              action: "speak",
              replyToMessageId: firstHuman.id,
              message: "这是对旧问题的迟到回复",
              entities: []
            });
        });
      }
    };
    const coordinator = new DiscussionCoordinator(room, [speaker], {
      maxMessagesPerAgent: 1,
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "新问题" });
    coordinator.notifyActivity();
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spoken).toEqual([]);
    expect(calls).toBe(2);
    coordinator.cancel();
    await running;
  });

  it("discards in-flight speech after cancel", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];

    let releaseSpeech: (() => void) | null = null;
    const blocked: DiscussionSpeaker = {
      seatId: "B",
      decideDiscussion: () =>
        new Promise((resolve) => {
          releaseSpeech = () =>
            resolve({ action: "speak", replyToMessageId: "human-1", message: "迟到的发言", entities: [] });
        })
    };

    const coordinator = new DiscussionCoordinator(room, [blocked], {
      maxMessagesPerAgent: 3,
      cooldownMs: 0,
      delay: instantDelay,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.cancel();
    releaseSpeech?.();
    await running;

    expect(spoken).toEqual([]);
  });

  it("aborts an in-flight provider request when discussion is cancelled", async () => {
    const room = makeDiscussionRoom();
    let observedSignal: AbortSignal | undefined;
    const blocked: DiscussionSpeaker = {
      seatId: "B",
      decideDiscussion: (_view, options) =>
        new Promise((_resolve, reject) => {
          observedSignal = options?.signal;
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    };
    const coordinator = new DiscussionCoordinator(room, [blocked], {
      cooldownMs: 0,
      requestDeadlineMs: 60_000,
      onMessage: () => {}
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.cancel();
    await running;

    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe("phase_changed");
  });

  it("discards in-flight speech when the phase moves on", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];

    let releaseSpeech: (() => void) | null = null;
    const blocked: DiscussionSpeaker = {
      seatId: "B",
      decideDiscussion: () =>
        new Promise((resolve) => {
          releaseSpeech = () =>
            resolve({ action: "speak", replyToMessageId: "human-1", message: "阶段结束后的发言", entities: [] });
        })
    };

    const coordinator = new DiscussionCoordinator(room, [blocked], {
      maxMessagesPerAgent: 3,
      cooldownMs: 0,
      delay: instantDelay,
      onMessage: (_seatId, message) => spoken.push(message)
    });

    const running = coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    room.phase = "placing";
    room.phaseVersion += 1;
    releaseSpeech?.();
    await running;

    expect(spoken).toEqual([]);
  });
});
