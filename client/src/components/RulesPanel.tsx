import React from "react";
import type { Condition } from "@take-time/shared";
import { ConditionList } from "./ConditionList.js";

interface RulesPanelProps {
  conditions: Condition[];
}

export function RulesPanel({ conditions }: RulesPanelProps) {
  return (
    <aside className="rules-panel" aria-label="本关规则">
      <h2 className="rules-panel__title">本关规则</h2>
      <ConditionList conditions={conditions} compact />
    </aside>
  );
}
