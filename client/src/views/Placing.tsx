import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoomStore } from "../store/useRoomStore.js";
import {
  hintLeftSelector,
  isMyTurnSelector,
  myHandTotalSelector,
  myPlayedCountSelector,
  mySeatIdSelector,
  mySeatSelector,
  teammateSeatsSelector,
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
  const roomState = useRoomStore((s) => s.roomState);
  const myHand = useRoomStore((s) => s.myHand);
  const timer = useRoomStore((s) => s.timer);
  const lastError = useRoomStore((s) => s.lastError);
  const isMyTurn = useRoomStore(isMyTurnSelector);
  const hintLeft = useRoomStore(hintLeftSelector);
  const mySeatId = useRoomStore(mySeatIdSelector);
  const mySeat = useRoomStore(mySeatSelector);
  // useShallow: the selector filters seats into a NEW array on every call;
  // without shallow comparison the unstable snapshot re-renders forever
  // (React #185) the moment Placing mounts.
  const teammates = useRoomStore(useShallow(teammateSeatsSelector));
  const myPlayed = useRoomStore(myPlayedCountSelector);
  const handTotal = useRoomStore(myHandTotalSelector);
  const totalPlaced = useRoomStore(totalPlacedSelector);
  const connState = useRoomStore((s) => s.connectionState);
  const isOffline = connState === "reconnecting" || connState === "disconnected";

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const leftRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const prevRoomStateRef = useRef(roomState);
  useEffect(() => {
    if (roomState !== prevRoomStateRef.current) {
      prevRoomStateRef.current = roomState;
      setIsPending(false);
      setSelectedCardId(null);
    }
  }, [roomState]);

  useEffect(() => {
    if (lastError && isPending) setIsPending(false);
  }, [lastError, isPending]);

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

  const pendingHint = roomState?.pendingHint ?? null;
  const isMyHintDecision = !!pendingHint && pendingHint.seatId === mySeatId;

  useEffect(() => {
    for (const ref of [leftRef, centerRef, rightRef]) {
      if (ref.current) ref.current.inert = isMyHintDecision;
    }
  }, [isMyHintDecision]);

  if (!roomState?.currentChallenge) {
    return <div className="view-stub">加载关卡中...</div>;
  }

  const { currentChallenge, placements, turn, hintMarkers, seats } = roomState;
  const isRace = turn === "race";
  const isLocked = !isMyTurn || isPending || isOffline || !!pendingHint;
  const turnSeat = turn && turn !== "race" ? seats.find((seat) => seat.id === turn) : null;
  const pendingHintSeat = pendingHint ? seats.find((seat) => seat.id === pendingHint.seatId) : null;
  const activeName = pendingHintSeat?.nick ?? turnSeat?.nick ?? "队友";
  const activeIsAgent = (pendingHintSeat ?? turnSeat)?.kind === "agent";

  const placedBySeat = (seatId: string) =>
    placements.reduce((count, segment) => count + segment.filter((card) => card.owner === seatId).length, 0);

  const nextOrder = totalPlaced + 1;
  const forcedSegment =
    !isLocked && selectedCardId
      ? forcedSegmentForOrder(currentChallenge.conditions, nextOrder)
      : null;

  return (
    <div className={`placing${pendingHint ? " placing--paused" : ""}`}>
      <div className="placing__left" ref={leftRef}>
        <RulesPanel conditions={currentChallenge.conditions} />

        <div className="placing__hand-section">
          <div className={`placing__player${isMyTurn && !pendingHint ? " placing__player--active" : ""}`}>
            <Avatar src={mySeat?.avatar} nick={mySeat?.nick ?? null} size={52} active={isMyTurn && !pendingHint} />
            <div className="placing__player-meta">
              <span className="placing__player-nick">{mySeat?.nick ?? "我"}</span>
              <span className="placing__player-role">你 · {Math.max(0, handTotal - myPlayed)}/{handTotal}</span>
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
          <p className="placing__pending-note">已发送，等待确认...</p>
        )}
      </div>

      <div className="placing__center" ref={centerRef}>
        {pendingHint ? (
          <p className="placing__turn-badge placing__turn-badge--hint">
            {isMyHintDecision ? "决定是否使用提示标记" : `等待 ${activeName} 决定是否使用提示标记${activeIsAgent ? "..." : ""}`}
          </p>
        ) : isRace ? (
          <p className="placing__turn-badge placing__turn-badge--race">抢先手！</p>
        ) : isMyTurn && !isPending ? (
          <p className="placing__turn-badge">轮到你出牌</p>
        ) : (
          <p className="placing__turn-badge placing__turn-badge--wait">
            等待 {activeName} 出牌{activeIsAgent ? "，AI 思考中..." : "..."}
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
            <span className="placing__big-timer placing__big-timer--idle">-</span>
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
                {i < hintLeft ? "●" : "○"}
              </span>
            ))}
          </div>
          <p className="placing__hints-remain">剩余 {hintLeft} / {hintMarkers.total}</p>
        </div>

        <div className="placing__right-section placing__right-section--teammates">
          <p className="placing__right-label">队友</p>
          {teammates.length > 0 ? (
            <div className="placing__teammate-list">
              {teammates.map((teammate) => {
                const isDeciding = pendingHint?.seatId === teammate.id;
                const isTakingTurn = !pendingHint && (turn === "race" || turn === teammate.id);
                const played = placedBySeat(teammate.id);
                const remaining = Math.max(0, handTotal - played);
                return (
                  <div key={teammate.id} className={`placing__player${isTakingTurn ? " placing__player--active" : ""}`}>
                    <div className="placing__player-avatar-col">
                      <Avatar src={teammate.avatar} nick={teammate.nick} size={52} active={isTakingTurn || isDeciding} />
                      <span className="placing__teammate-hand">{remaining}/{handTotal}</span>
                    </div>
                    <div className="placing__player-meta">
                      <span className="placing__player-nick">{teammate.nick}</span>
                      <span className="placing__opponent-status">
                        {isDeciding ? (
                          <span style={{ color: "var(--warn)" }}>决定提示标记中...</span>
                        ) : isTakingTurn ? (
                          <span style={{ color: "var(--turn)" }}>{teammate.kind === "agent" ? "AI 思考中..." : "出牌中..."}</span>
                        ) : teammate.kind === "agent" ? (
                          "AI 待命"
                        ) : (
                          "等待中..."
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="placing__opponent-status">-</p>
          )}
        </div>
      </div>

      {isMyHintDecision && pendingHint && (
        <HintPrompt
          pendingHint={pendingHint}
          hintMarkers={hintMarkers}
        />
      )}
    </div>
  );
}
