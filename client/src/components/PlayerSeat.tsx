import React from "react";
import type { SeatId } from "@take-time/shared";
import { Button } from "./Button.js";

interface PlayerSeatProps {
  id: SeatId;
  nick: string | null;
  isHost: boolean;
  isReady: boolean;
  isMe: boolean;
  disabled?: boolean;
  onReady?: () => void;
  onCancelReady?: () => void;
}

export function PlayerSeat({
  id,
  nick,
  isHost,
  isReady,
  isMe,
  disabled = false,
  onReady,
  onCancelReady,
}: PlayerSeatProps) {
  const isEmpty = nick === null;

  return (
    <div
      className={[
        "player-seat",
        isMe ? "player-seat--me" : "",
        isReady ? "player-seat--ready" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="player-seat__header">
        <span className="player-seat__id mono">座位 {id}</span>
        {isHost && (
          <span className="player-seat__host-badge" aria-label="房主">⌂ 房主</span>
        )}
      </div>

      <p className={`player-seat__nick${isEmpty ? " player-seat__nick--empty" : ""}`}>
        {isEmpty ? "等待加入…" : nick}
      </p>

      {isMe && !isEmpty && (
        <div className="player-seat__actions">
          {isReady ? (
            <Button variant="ghost" onClick={onCancelReady} disabled={disabled} className="player-seat__btn">
              已准备 ✓
            </Button>
          ) : (
            <Button onClick={onReady} disabled={disabled} className="player-seat__btn">
              准备
            </Button>
          )}
        </div>
      )}

      {!isMe && !isEmpty && (
        <p className="player-seat__status">
          {isReady ? "✓ 已准备" : "等待准备…"}
        </p>
      )}
    </div>
  );
}
