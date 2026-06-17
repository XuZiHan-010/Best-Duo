import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { isHostSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { ClockBoard } from "../components/ClockBoard.js";
import { ConditionList } from "../components/ConditionList.js";

export function Reveal() {
  const roomState = useRoomStore((s) => s.roomState);
  const isHost    = useRoomStore(isHostSelector);
  const connState = useRoomStore((s) => s.connectionState);
  const isOffline = connState === "reconnecting" || connState === "disconnected";

  if (!roomState?.currentChallenge || !roomState.revealResult) {
    return <div className="view-stub">揭示中…</div>;
  }

  const { currentChallenge, placements, revealResult } = roomState;
  const { pass, segmentSums, segmentCounts, conditions: condResults } = revealResult;

  // 解析每段上限（"inf" = ∞；null/省略 = 官方默认 24）。
  const cap = currentChallenge.centerCap === "inf" ? Infinity : (currentChallenge.centerCap ?? 24);

  // 标出违反三条全局规则的区段：空段 / 超上限 / 段间递减。
  const segmentViolation = (i: number): string | null => {
    if (segmentCounts[i] === 0) return "空段";
    if (segmentSums[i] > cap) return `> ${cap}`;
    if (i > 0 && segmentSums[i] < segmentSums[i - 1]) return "< 前段";
    return null;
  };

  return (
    <div className={`reveal ${pass ? "reveal--success" : "reveal--fail"}`}>
      <div className="reveal__main">
        <div className="reveal__banner">
          <span className="reveal__banner-icon" aria-hidden="true">
            {pass ? "✦" : "✕"}
          </span>
          <span>{pass ? "通关！" : "挑战失败 · 条件未满足"}</span>
        </div>

        <div className="reveal__clock-col">
          <ClockBoard
            centerCap={currentChallenge.centerCap}
            placements={placements}
            revealMode
          />

          {/* Segment sums row */}
          <div className="reveal__sums" aria-label="各区段总和">
            {segmentSums.map((sum, i) => {
              const violation = segmentViolation(i);
              return (
                <div
                  key={i}
                  className={`reveal__sum-item${violation ? " reveal__sum-item--violation" : ""}`}
                  style={{ animationDelay: `${i * 120 + 100}ms` }}
                  title={violation ? `违反全局规则：${violation}` : undefined}
                >
                  <span className="reveal__sum-label">S{i + 1}</span>
                  <span className="reveal__sum-value">{sum}</span>
                  {violation && <span className="reveal__sum-flag" aria-label={`违规：${violation}`}>{violation}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="reveal__conditions-col">
          <h2 className="reveal__conditions-title">条件校验</h2>
          <ConditionList
            conditions={currentChallenge.conditions}
            results={condResults}
          />
        </div>
      </div>

      <div className="reveal__continue">
        {isHost ? (
          <button
            className="btn btn--primary reveal__continue-btn"
            disabled={isOffline}
            onClick={() => adapter.continueToResult()}
          >
            继续 →
          </button>
        ) : (
          <p className="reveal__waiting">等待房主继续…</p>
        )}
      </div>
    </div>
  );
}
