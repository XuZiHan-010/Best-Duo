// client/src/components/ConditionList.tsx
import React from "react";
import type { Condition, ConditionResult } from "@take-time/shared";
import { conditionToText } from "../lib/conditionText.js";

interface ConditionListProps {
  conditions: Condition[];
  results?: ConditionResult[];  // Reveal 阶段传入，显示 ✓/✗
  compact?: boolean;            // RulesPanel 精简模式（字号更小）
}

export function ConditionList({ conditions, results, compact }: ConditionListProps) {
  return (
    <ul
      className={`condition-list${compact ? " condition-list--compact" : ""}`}
      role="list"
    >
      {conditions.map((c, i) => {
        const result = results?.[i];
        const cls = result
          ? result.pass
            ? " condition-list__item--pass"
            : " condition-list__item--fail"
          : "";
        return (
          <li key={i} className={`condition-list__item${cls}`}>
            {result && (
              <span className="condition-list__icon" aria-hidden="true">
                {result.pass ? "✓" : "✗"}
              </span>
            )}
            <span className="condition-list__text">{conditionToText(c)}</span>
            {result && (
              <span className="condition-list__msg">{result.message}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
