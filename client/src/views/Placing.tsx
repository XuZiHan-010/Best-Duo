import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import {
  hintLeftSelector,
  isMyTurnSelector,
  mySeatIdSelector,
  mySeatSelector,
  teammateSeatSelector,
  myPlayedCountSelector,
  totalPlacedSelector,
} from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { forcedSegmentForOrder } from "../lib/segmentHints.js";
import { Avatar } from "../components/Avatar.js";
import { ClockBoard } from "../components/ClockBoard.js";
import { CountdownTimer } from "../components/CountdownTimer.js";
import { HandRail } from "../components/HandRail.js";
import { HintPrompt } from "../components/HintPrompt.js";
import { RulesPanel } from "../components/RulesPanel.js";

export function Placing() {
  const roomState   = useRoomStore((s) => s.roomState);
  const myHand      = useRoomStore((s) => s.myHand);
  const timer       = useRoomStore((s) => s.timer);
  const lastError   = useRoomStore((s) => s.lastError);
  const isMyTurn    = useRoomStore(isMyTurnSelector);
  const hintLeft    = useRoomStore(hintLeftSelector);
  const mySeatId    = useRoomStore(mySeatIdSelector);
  const mySeat      = useRoomStore(mySeatSelector);
  const teammate    = useRoomStore(teammateSeatSelector);
  const myPlayed    = useRoomStore(myPlayedCountSelector);
  const totalPlaced = useRoomStore(totalPlacedSelector);
  const connState   = useRoomStore((s) => s.connectionState);
  const isOffline   = connState === "reconnecting" || connState === "disconnected";

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const leftRef   = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const rightRef  = useRef<HTMLDivElement>(null);

  // Clear pending and deselect whenever the server sends a new room:state
  const prevRoomStateRef = useRef(roomState);
  useEffect(() => {
    if (roomState !== prevRoomStateRef.current) {
      prevRoomStateRef.current = roomState;
      setIsPending(false);
      setSelectedCardId(null);
    }
  }, [roomState]);

  // Also clear pending on server error (race rejection)
  useEffect(() => {
    if (lastError && isPending) setIsPending(false);
  }, [lastError, isPending]);

  // Esc cancels card selection (but NOT during hint prompt — HintPrompt handles its own keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !roomState?.pendingHint) setSelectedCardId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomState?.pendingHint]);

  const handleSelectCard = useCallback((cardId: string) => {
    setSelectedCardId(cardId || null);
  }, []);

  const handleSegmentClick = useCallback((segment: number) => {
    if (!selectedCardId || !isMyTurn || isPending || isOffline || roomState?.pendingHint) return;
    setIsPending(true);
    adapter.placeCard({ cardId: selectedCardId, segment });
  }, [selectedCardId, isMyTurn, isPending, isOffline, roomState?.pendingHint]);

  // I am the one who needs to decide the hint (or teammate is deciding)
  const pendingHint = roomState?.pendingHint ?? null;
  const isMyHintDecision = !!pendingHint && pendingHint.seatId === mySeatId;

  // The dialog must be the only reachable thing while it's open — pointer-
  // events:none (the .placing--paused rule) only blocks mouse/touch, so the
  // background also needs `inert` to keep keyboard/AT navigation out of it.
  useEffect(() => {
    for (const ref of [leftRef, centerRef, rightRef]) {
      if (ref.current) ref.current.inert = isMyHintDecision;
    }
  }, [isMyHintDecision]);

  if (!roomState?.currentChallenge) {
    return <div className="view-stub">加载关卡中…</div>;
  }

  const { currentChallenge, placements, turn, hintMarkers } = roomState;
  const isTeammateDeciding = !!pendingHint && pendingHint.seatId !== mySeatId;

  // A seat is "about to play" when it's their turn — or during the race phase
  // when either player may move (both highlight, as expected with 2 players).
  const isTeammateTurn = !pendingHint && (turn === "race" || (teammate ? turn === teammate.id : false));

  // Board is locked when: not my turn, pending server reply, hint window is
  // open, or the socket is reconnecting (queued emits could land stale once
  // the seat re-attaches).
  const isLocked = !isMyTurn || isPending || isOffline || !!pendingHint;
  const isRace   = turn === "race";

  const teammatePlayed = totalPlaced - myPlayed;

  // 显示剩余手牌（剩余/初始）。初始手牌数 = 当前手牌 + 已出（随发牌规则自适应，
  // 不写死 6）；队友牌不可见，用对称发牌假设按初始数 - 已出推算。
  const myHandTotal = (myHand?.length ?? 0) + myPlayed;
  const myHandRemaining = myHand?.length ?? 0;
  const teammateHandRemaining = Math.max(0, myHandTotal - teammatePlayed);

  // 下一张牌的全局出牌序号（1-based）；若关卡要求该序号必须落在某区则强制。
  const nextOrder = totalPlaced + 1;
  const forcedSegment =
    !isLocked && selectedCardId
      ? forcedSegmentForOrder(currentChallenge.conditions, nextOrder)
      : null;

  return (
    <div className={`placing${pendingHint ? " placing--paused" : ""}`}>

      {/* LEFT: rules + hand */}
      <div className="placing__left" ref={leftRef}>
        <RulesPanel conditions={currentChallenge.conditions} />

        <div className="placing__hand-section">
          <div className={`placing__player${isMyTurn && !pendingHint ? " placing__player--active" : ""}`}>
            <Avatar src={mySeat?.avatar} nick={mySeat?.nick ?? null} size={52} active={isMyTurn && !pendingHint} />
            <div className="placing__player-meta">
              <span className="placing__player-nick">{mySeat?.nick ?? "我"}</span>
              <span className="placing__player-role">你</span>
            </div>
          </div>
          <p className="placing__hand-label">我的手牌</p>
          <HandRail
            cards={myHand ?? []}
            selectedCardId={isPending ? null : selectedCardId}
            disabled={isLocked}
            onSelect={handleSelectCard}
          />
        </div>

        {isPending && (
          <p className="placing__pending-note">已发送，等待确认…</p>
        )}
      </div>

      {/* CENTER: clock */}
      <div className="placing__center" ref={centerRef}>
        {pendingHint ? (
          <p className="placing__turn-badge placing__turn-badge--hint">
            {isMyHintDecision ? "⏸ 决定是否翻牌" : `⏸ ${teammate?.nick ?? "队友"} 决定中…`}
          </p>
        ) : isRace ? (
          <p className="placing__turn-badge placing__turn-badge--race">◉ 抢先手！</p>
        ) : isMyTurn && !isPending ? (
          <p className="placing__turn-badge">◉ 轮到你出牌</p>
        ) : (
          <p className="placing__turn-badge placing__turn-badge--wait">
            等待 {teammate?.nick ?? "队友"} 出牌…
          </p>
        )}

        <ClockBoard
          centerCap={currentChallenge.centerCap}
          placements={placements}
          interactive={!isLocked}
          cardSelected={!!selectedCardId}
          conditions={currentChallenge.conditions}
          forcedSegment={forcedSegment}
          onSegmentClick={handleSegmentClick}
        />

        {selectedCardId && !isLocked && (
          <p className="placing__hint-text">
            {forcedSegment !== null
              ? `第 ${nextOrder} 张必须放入区 ${forcedSegment + 1}`
              : "选择一个区段放入"}
          </p>
        )}
      </div>

      {/* RIGHT: timer + hints + teammate */}
      <div className="placing__right" ref={rightRef}>
        <div className="placing__right-section">
          <p className="placing__right-label">回合倒计时</p>
          {timer?.kind === "turn" ? (
            <CountdownTimer
              deadline={timer.deadline}
              warnThresholdMs={3000}
              dangerThresholdMs={2000}
              className="placing__big-timer"
            />
          ) : (
            <span className="placing__big-timer placing__big-timer--idle">—</span>
          )}
        </div>

        <div className="placing__right-section">
          <p className="placing__right-label">提示标记</p>
          <div className="placing__hints">
            {Array.from({ length: hintMarkers.total }).map((_, i) => (
              <span
                key={i}
                className={i < hintLeft ? "placing__hint-dot" : "placing__hint-dot placing__hint-dot--used"}
                aria-hidden="true"
              >
                {i < hintLeft ? "◆" : "◇"}
              </span>
            ))}
          </div>
          <p className="placing__hints-remain">剩余 {hintLeft} / {hintMarkers.total}</p>
        </div>

        <div className="placing__right-section">
          <p className="placing__right-label">队友</p>
          {teammate ? (
            <div className={`placing__player${isTeammateTurn ? " placing__player--active" : ""}`}>
              <div className="placing__player-avatar-col">
                <Avatar src={teammate.avatar} nick={teammate.nick} size={52} active={isTeammateTurn} />
                <span className="placing__teammate-hand">{teammateHandRemaining}/{myHandTotal}</span>
              </div>
              <div className="placing__player-meta">
                <span className="placing__player-nick">{teammate.nick}</span>
                <span className="placing__opponent-status">
                  {isTeammateDeciding ? (
                    <span style={{ color: "var(--warn)" }}>决定翻牌中…</span>
                  ) : isTeammateTurn ? (
                    <span style={{ color: "var(--turn)" }}>出牌中…</span>
                  ) : (
                    "等待中…"
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="placing__opponent-status">—</p>
          )}
        </div>
      </div>

      {/* HINT PROMPT — only shown to the deciding player */}
      {isMyHintDecision && pendingHint && (
        <HintPrompt
          pendingHint={pendingHint}
          hintMarkers={hintMarkers}
        />
      )}

    </div>
  );
}
