import React, { useState } from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { isHostSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { ConditionList } from "../components/ConditionList.js";
import { AgentPublicSummary, agentStateForSeat } from "../components/AgentPublicSummary.js";

const FAILURE_REASON_TEXT: Record<string, string> = {
  "rule-unmet":  "条件未满足",
  "timeout":     "回合超时判负",
  "player-left": "队友已离开",
};

export function Result() {
  const roomState = useRoomStore((s) => s.roomState);
  const isHost    = useRoomStore(isHostSelector);
  const connState = useRoomStore((s) => s.connectionState);
  const isOffline = connState === "reconnecting" || connState === "disconnected";
  const [confirming, setConfirming] = useState<"retry" | "backToLevelSelect" | null>(null);

  if (!roomState?.currentChallenge) {
    return <div className="view-stub">加载结算中…</div>;
  }

  // failByTimeout / failByPlayerLeft (server) skip straight to "result"
  // without ever populating revealResult — only revealAndScore (a real
  // reveal) does. Treat the missing case as a plain failure with no
  // per-condition detail, instead of getting stuck on the loading stub.
  const { revealResult, failureReason, currentLevelIndex, levelSummaries } = roomState;
  const pass = revealResult?.pass ?? false;
  const condResults = revealResult?.conditions ?? [];
  const currentLevelNumber = roomState.currentChallenge?.levelIndex ?? currentLevelIndex;
  const nextLevelNumber = currentLevelNumber !== null ? currentLevelNumber + 1 : null;

  const hasNextLevel =
    nextLevelNumber !== null &&
    levelSummaries.some((level) => level.levelIndex === nextLevelNumber);

  const failedConditions = condResults.filter((r) => !r.pass);

  return (
    <div className={`result ${pass ? "result--success" : "result--fail"}`}>

      {/* Header */}
      <div className="result__header">
        <div className="result__icon" aria-hidden="true">
          {pass ? "✦" : "✕"}
        </div>
        <h1 className="result__title">
          {pass ? "通关！" : "挑战失败"}
        </h1>
        {pass && (
          <p className="result__subtitle">
            第 {currentLevelNumber ?? "?"} 关已记入进度
          </p>
        )}
        {!pass && failureReason && (
          <p className="result__subtitle result__subtitle--fail">
            {FAILURE_REASON_TEXT[failureReason] ?? failureReason}
          </p>
        )}
      </div>

      {/* Failure detail */}
      {!pass && failedConditions.length > 0 && (
        <div className="result__detail">
          <h2 className="result__detail-title">未满足的条件</h2>
          <ConditionList
            conditions={failedConditions.map((r) => r.condition)}
            results={failedConditions}
          />
        </div>
      )}

      {roomState.agentState.seats.length > 0 && (
        <section className="result__agent-review">
          <div className="result__agent-review-head"><p>AGENT REVIEW</p><h2>AI 队友协作复盘</h2></div>
          <div className="result__agent-grid">
            {roomState.seats.filter((seat) => seat.kind === "agent" && seat.nick).map((seat) => (
              <article key={seat.id}><strong>{seat.nick}</strong><AgentPublicSummary
                state={agentStateForSeat(roomState.agentState.seats, seat.id)}
                reveal={roomState.revealResult ? { placements: roomState.placements, revealResult: roomState.revealResult } : undefined}
              /></article>
            ))}
          </div>
          {roomState.agentState.review && <div className="result__agent-lessons">
            {roomState.agentState.review.lessons.map((lesson) => <p key={lesson}>↳ {lesson}</p>)}
            {roomState.agentState.review.unresolvedIssues.map((issue) => <p key={issue} className="is-unresolved">? {issue}</p>)}
          </div>}
        </section>
      )}

      {/* Actions — host only */}
      {isHost ? (
        <div className="result__actions">
          {pass && hasNextLevel && (
            <button className="btn btn--primary result__btn" disabled={isOffline} onClick={() => adapter.nextLevel()}>
              进入第 {nextLevelNumber ?? "?"} 关 →
            </button>
          )}
          {!pass && (
            confirming === "retry" ? (
              <span className="result__confirm-group">
                <span className="result__confirm-text">确认重试，丢弃本局？</span>
                <button className="btn btn--primary result__btn" disabled={isOffline} onClick={() => adapter.retry()}>
                  确认
                </button>
                <button className="btn btn--ghost result__btn" disabled={isOffline} onClick={() => setConfirming(null)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn btn--primary result__btn" disabled={isOffline} onClick={() => setConfirming("retry")}>
                重试本关
              </button>
            )
          )}
          {confirming === "backToLevelSelect" ? (
            <span className="result__confirm-group">
              <span className="result__confirm-text">确认返回选关？</span>
              <button className="btn btn--primary result__btn" disabled={isOffline} onClick={() => adapter.backToLevelSelect()}>
                确认
              </button>
              <button className="btn btn--ghost result__btn" disabled={isOffline} onClick={() => setConfirming(null)}>
                取消
              </button>
            </span>
          ) : (
            <button className="btn btn--ghost result__btn" disabled={isOffline} onClick={() => setConfirming("backToLevelSelect")}>
              返回选关
            </button>
          )}
          {isOffline && (
            <p className="result__waiting">正在恢复连接，操作暂停…</p>
          )}
        </div>
      ) : (
        <p className="result__waiting">等待房主决定…</p>
      )}

    </div>
  );
}
