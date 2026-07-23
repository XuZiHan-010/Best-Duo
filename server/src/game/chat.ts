import { randomUUID } from "node:crypto";
import type { ChatMessage, GameRoom, SeatId, SeatKind } from "@take-time/shared";

interface ChatMessageInput {
  senderSeatId: SeatId;
  kind: SeatKind;
  nick: string;
  text: string;
}

export const appendChatMessage = (room: GameRoom, input: ChatMessageInput): ChatMessage => {
  const attemptId = room.identity.attemptId;
  if (!attemptId) throw new Error("当前没有进行中的 attempt，不能发送聊天");

  const message: ChatMessage = {
    id: randomUUID(),
    attemptId,
    senderSeatId: input.senderSeatId,
    kind: input.kind,
    nick: input.nick,
    text: input.text,
    ts: Date.now()
  };
  room.chat.push(message);
  return message;
};

// Agent context 只允许读取当前 attempt 的公开聊天。
export const chatForCurrentAttempt = (room: GameRoom): ChatMessage[] =>
  room.chat.filter((message) => message.attemptId === room.identity.attemptId);
