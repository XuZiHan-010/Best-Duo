import React, { useRef, useEffect, useState } from "react";
import type { ChatMessage } from "@take-time/shared";
import { adapter } from "../socket/adapter.js";

interface ChatProps {
  messages: ChatMessage[];
  mySeatId: string | null;
}

export function Chat({ messages, mySeatId }: ChatProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    adapter.sendChat({ text: trimmed });
    setText("");
  }

  return (
    <div className="chat">
      <ol
        className="chat__list"
        ref={listRef}
        aria-live="polite"
        aria-label="聊天记录"
      >
        {messages.length === 0 && (
          <li className="chat__empty">还没有消息，开始讨论…</li>
        )}
        {messages.map((msg) => (
          <li
            key={msg.id}
            className={`chat__msg${msg.senderSeatId === mySeatId ? " chat__msg--mine" : ""}`}
          >
            <span className="chat__nick">{msg.nick}：</span>
            <span className="chat__text">{msg.text}</span>
          </li>
        ))}
      </ol>

      <form className="chat__form" onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className="sr-only">
          发送消息
        </label>
        <input
          id="chat-input"
          className="chat__input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入消息…"
          maxLength={200}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn btn--ghost chat__send"
          disabled={!text.trim()}
        >
          发送
        </button>
      </form>
    </div>
  );
}
