import type { SeatId, SeatKind } from "@take-time/shared";
import { Button } from "./Button.js";
import { Avatar } from "./Avatar.js";

interface PlayerSeatProps {
  id: SeatId;
  kind: SeatKind;
  nick: string | null;
  avatar?: string | null;
  isHost: boolean;
  isReady: boolean;
  isMe: boolean;
  disabled?: boolean;
  canAddAgent?: boolean;
  canRemoveAgent?: boolean;
  onReady?: () => void;
  onCancelReady?: () => void;
  onAddAgent?: () => void;
  onRemoveAgent?: () => void;
}

export function PlayerSeat({
  id,
  kind,
  nick,
  avatar,
  isHost,
  isReady,
  isMe,
  disabled = false,
  canAddAgent = false,
  canRemoveAgent = false,
  onReady,
  onCancelReady,
  onAddAgent,
  onRemoveAgent,
}: PlayerSeatProps) {
  const isEmpty = nick === null;
  const isAgent = kind === "agent" && !isEmpty;

  return (
    <div
      className={[
        "player-seat",
        isMe ? "player-seat--me" : "",
        isReady ? "player-seat--ready" : "",
        isAgent ? "player-seat--agent" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="player-seat__header">
        <span className="player-seat__id mono">座位 {id}</span>
        {isHost && (
          <span className="player-seat__host-badge" aria-label="房主">房主</span>
        )}
        {isAgent && <span className="player-seat__agent-badge">AI</span>}
      </div>

      <div className="player-seat__identity">
        {!isEmpty && <Avatar src={avatar} nick={nick} size={80} />}
        <p className={`player-seat__nick${isEmpty ? " player-seat__nick--empty" : ""}`}>
          {isEmpty ? "等待加入..." : nick}
        </p>
      </div>

      {isEmpty && canAddAgent && (
        <div className="player-seat__actions">
          <Button variant="ghost" onClick={onAddAgent} disabled={disabled} className="player-seat__btn">
            添加 AI
          </Button>
        </div>
      )}

      {isMe && !isEmpty && !isAgent && (
        <div className="player-seat__actions">
          {isReady ? (
            <Button variant="ghost" onClick={onCancelReady} disabled={disabled} className="player-seat__btn">
              已准备
            </Button>
          ) : (
            <Button onClick={onReady} disabled={disabled} className="player-seat__btn">
              准备
            </Button>
          )}
        </div>
      )}

      {!isMe && !isEmpty && !isAgent && (
        <p className="player-seat__status">
          {isReady ? "已准备" : "等待准备..."}
        </p>
      )}

      {isAgent && (
        <div className="player-seat__agent-row">
          <p className="player-seat__status">AI 已就绪</p>
          {canRemoveAgent && (
            <Button variant="danger" onClick={onRemoveAgent} disabled={disabled} className="player-seat__remove-btn">
              移除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
