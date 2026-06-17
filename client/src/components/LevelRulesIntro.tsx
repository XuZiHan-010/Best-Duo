import React, { useEffect, useRef } from "react";
import type { Condition } from "@take-time/shared";
import { ConditionList } from "./ConditionList.js";

interface LevelRulesIntroProps {
  levelName: string;
  difficulty: string;
  centerCap: number | "inf" | null;
  conditions: Condition[];
  onAccept: () => void;
}

export function LevelRulesIntro({
  levelName,
  difficulty,
  centerCap,
  conditions,
  onAccept,
}: LevelRulesIntroProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  const capText =
    centerCap === "inf"
      ? "∞（无上限）"
      : `≤ ${centerCap ?? 24}`;

  return (
    <div
      className="level-rules-intro"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lri-title"
    >
      <div className="level-rules-intro__card">
        <h2 id="lri-title" className="level-rules-intro__title">
          本关规则 · {levelName} {difficulty}
        </h2>

        {/* 全局永久规则（每关固定） */}
        <section aria-label="全局永久规则" className="level-rules-intro__global">
          <h3 className="level-rules-intro__section-title">全局规则（每关固定）</h3>
          <ul className="level-rules-intro__global-list">
            <li>所有区段至少 1 张牌</li>
            <li>区1 ≤ 区2 ≤ 区3 ≤ 区4 ≤ 区5 ≤ 区6 依次非递减</li>
            <li>每区段总和 {capText}</li>
          </ul>
        </section>

        {/* 本关特殊条件 */}
        {conditions.length > 0 && (
          <section aria-label="本关特殊条件">
            <h3 className="level-rules-intro__section-title">本关特殊条件</h3>
            <ConditionList conditions={conditions} />
          </section>
        )}

        <hr className="level-rules-intro__divider" />

        <section aria-label="卡牌图例">
          <h3 className="level-rules-intro__legend-title">卡牌图例</h3>
          <div className="level-rules-intro__legend-items">
            <span className="card-demo card-demo--white" title="白牌">白</span>
            <span className="card-demo card-demo--black" title="黑牌">黑</span>
            <span className="card-demo card-demo--blind" title="手牌盲位">?</span>
            <span className="card-demo card-demo--hint" title="提示翻开牌">◆</span>
          </div>
          <p className="level-rules-intro__deck-note">
            牌库 24 张：白 1–12 + 黑 1–12，每局发 12 张
          </p>
        </section>

        <button
          ref={btnRef}
          className="btn btn--primary level-rules-intro__btn"
          onClick={onAccept}
        >
          已了解，开始讨论 →
        </button>
      </div>
    </div>
  );
}
