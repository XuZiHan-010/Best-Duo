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
  appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "初始讨论" });
  return room;
};

const instantDelay = async () => {};

const waitForCondition = async (predicate: () => boolean, timeoutMs = 3_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
};

// 每次都回应最新真人消息的发言者。
const alwaysReplySpeaker = (seatId: SeatId, onCall?: (chatLength: number) => void): DiscussionSpeaker => ({
  seatId,
  async decideDiscussion(view) {
    onCall?.(view.chat.length);
    const focusMessage = [...view.chat].reverse().find((message) => message.kind === "human");
    if (!focusMessage) return { action: "wait", reason: "no_substantive_input" };
    return { action: "speak", replyToMessageId: focusMessage.id, message: `回应:${focusMessage.text}`, entities: [] };
  }
});

// P1-1：产品层不限制 AI 每局发言次数——真人持续给出新内容时，
// AI 不得因整局 3 条上限而永久沉默（2026-07-21 findings）。
describe("讨论发言不设次数上限", () => {
  it("真人连续 5 轮发言后 AI 仍在回应（超过旧的 3 条上限）", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];

    const coordinator = new DiscussionCoordinator(room, [alwaysReplySpeaker("B")], {
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: (_seatId, message) => spoken.push(message)
    });
    const running = coordinator.start();

    // 初始消息触发第 1 条回应；随后真人再连发 4 轮，每轮都应有回应。
    await waitForCondition(() => spoken.length === 1);
    for (let round = 2; round <= 5; round += 1) {
      appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: `第${round}轮方案` });
      coordinator.notifyActivity();
      await waitForCondition(() => spoken.length === round);
    }

    expect(spoken.length).toBe(5);
    coordinator.cancel();
    await running;
  });
});

// P1-2：真人连发消息时，思考中的旧请求应被取消（superseded），
// 随后只对最新完整上下文调用一次，且被取代不计入模型失败熔断。
describe("讨论请求被新消息取代", () => {
  it("新真人消息到达时取消在途请求，只对最新上下文重新调用一次", async () => {
    const room = makeDiscussionRoom();
    const spoken: string[] = [];
    const callChatLengths: number[] = [];
    const exhausted: SeatId[] = [];

    const speaker: DiscussionSpeaker = {
      seatId: "B",
      decideDiscussion(view, options) {
        callChatLengths.push(view.chat.length);
        if (callChatLengths.length === 1) {
          // 第一次调用悬挂，仅在被取消时返回 null（模拟 orchestrator 的 cancelled → null）。
          return new Promise((resolve) => {
            options?.signal?.addEventListener("abort", () => resolve(null), { once: true });
          });
        }
        const focusMessage = [...view.chat].reverse().find((message) => message.kind === "human");
        return Promise.resolve(
          focusMessage
            ? { action: "speak", replyToMessageId: focusMessage.id, message: `回应:${focusMessage.text}`, entities: [] }
            : { action: "wait", reason: "no_substantive_input" }
        );
      }
    };

    const coordinator = new DiscussionCoordinator(room, [speaker], {
      cooldownMs: 0,
      delay: instantDelay,
      waitForActivity: true,
      onMessage: (_seatId, message) => spoken.push(message),
      onSpeakerExhausted: (seatId) => exhausted.push(seatId)
    });
    const running = coordinator.start();

    // 等第一次调用真正挂起后，真人追加新消息。
    await waitForCondition(() => callChatLengths.length === 1);
    appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "补充：区5收大牌" });
    coordinator.notifyActivity();

    // 旧请求被取消，新调用携带完整两条聊天，只回应最新消息。
    await waitForCondition(() => spoken.length === 1);
    expect(callChatLengths).toEqual([1, 2]);
    expect(spoken).toEqual(["回应:补充：区5收大牌"]);
    // 被取代的请求不计模型失败：不得触发耗尽通告。
    expect(exhausted).toEqual([]);

    coordinator.cancel();
    await running;
  });
});
