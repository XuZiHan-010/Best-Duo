import { describe, expect, it } from "vitest";
import type { Challenge, ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { appendChatMessage, chatForCurrentAttempt } from "../src/game/chat.js";
import { enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeChallenge = (id: string): Challenge => ({
  id,
  name: `测试关卡 ${id}`,
  levelIndex: 0,
  difficulty: "★",
  segmentCount: 6,
  centerCap: "inf",
  playable: true,
  conditions: [{ type: "all-nonempty" }]
});

const makeDiscussionRoom = () => {
  const room = createGameRoom(progress, 4);
  room.phase = "levelSelect";
  enterDiscussion(room, makeChallenge("level-01"));
  return room;
};

describe("chat attempt scoping", () => {
  it("stamps new chat messages with the current attemptId", () => {
    const room = makeDiscussionRoom();

    const message = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "Alice", text: "大家好" });

    expect(message.attemptId).toBe(room.identity.attemptId);
    expect(room.chat).toHaveLength(1);
    expect(room.chat[0].attemptId).toBe(room.identity.attemptId);
  });

  it("rejects chat when no attempt is active", () => {
    const room = createGameRoom(progress, 4);

    expect(() => appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "Alice", text: "hi" })).toThrow();
  });

  it("only returns current-attempt messages for agent context", () => {
    const room = makeDiscussionRoom();
    appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "Alice", text: "本 attempt 消息" });
    room.chat.push({
      id: "stale-1",
      attemptId: "some-old-attempt",
      senderSeatId: "B",
      kind: "human",
      nick: "Bob",
      text: "旧 attempt 残留",
      ts: Date.now()
    });

    const scoped = chatForCurrentAttempt(room);

    expect(scoped).toHaveLength(1);
    expect(scoped[0].text).toBe("本 attempt 消息");
  });
});
