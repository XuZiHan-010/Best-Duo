import {
  evaluateAgreementFulfillment,
  type AgreementVerdict,
  type PublicAgentSeatState,
  type PublicAgentStrategyRule,
  type PublicPlacedCard,
  type RevealResult,
  type SeatId
} from "@take-time/shared";
import { conditionToText } from "../lib/conditionText.js";

const RULE_LABEL: Record<string, string> = {
  segment_assignment: "区段分工",
  avoid_segment: "避让区段",
  card_property_preference: "牌面偏好",
  placement_order: "出牌次序",
  hint_policy: "提示策略",
  custom: "协作约定",
};

const FALLBACK_LABEL: Record<string, string> = {
  provider_error: "模型暂不可用，已采用安全策略",
  timeout: "模型超时，已采用安全策略",
  illegal_output: "模型结果无效，已采用安全策略",
  breaker_open: "模型连续失败，已切换安全策略",
  budget_exceeded: "本局 AI 预算用尽，已采用安全策略",
};

// 结算后传入：用于逐条约定对照终局牌面判定「目标区段是否达标」。
export interface RevealContext {
  placements: PublicPlacedCard[][];
  revealResult: RevealResult;
}

const VERDICT_LABEL: Record<AgreementVerdict, string> = {
  met: "✓ 达标",
  unmet: "✗ 未达标",
  "no-target": "无目标区段，无法定位",
};

function ruleLabel(rule: PublicAgentStrategyRule): string {
  return RULE_LABEL[rule.type] ?? rule.type;
}

// 结算复盘行：诚实口径为「该约定针对的区段是否达标」，非「AI 是否守约」。
function AgreementRow({ rule, reveal }: { rule: PublicAgentStrategyRule; reveal: RevealContext }) {
  const fulfillment = evaluateAgreementFulfillment(rule, reveal.placements, reveal.revealResult);
  return <li className={`agent-agreement is-${fulfillment.verdict}`}>
    <div className="agent-agreement__head">
      <strong>{ruleLabel(rule)}</strong>
      <em className="agent-agreement__verdict">{VERDICT_LABEL[fulfillment.verdict]}</em>
    </div>
    {fulfillment.segments.map((seg) => <div key={seg.segment} className="agent-agreement__seg">
      <span className="agent-agreement__compo">
        区段 {seg.segment + 1} 终局：{seg.composition.count} 张
        {seg.composition.count > 0
          ? `（${seg.composition.black} 黑 ${seg.composition.white} 白，和 ${seg.composition.sum}）`
          : ""}
      </span>
      {seg.requirements.length === 0
        ? <span className="agent-agreement__req is-neutral">仅受全局规则约束 ✓</span>
        : seg.requirements.map((req, index) => <span
            key={index}
            className={`agent-agreement__req ${req.pass ? "is-pass" : "is-fail"}`}
          >
            {req.pass ? "✓" : "✗"} {conditionToText(req.condition)}
          </span>)}
      {seg.spanningIssues.map((condition, index) => <span key={`sp-${index}`} className="agent-agreement__span">
        ↳ 跨区段未达标：{conditionToText(condition)}
      </span>)}
    </div>)}
  </li>;
}

export function AgentPublicSummary(
  { state, compact = false, reveal }: { state?: PublicAgentSeatState; compact?: boolean; reveal?: RevealContext }
) {
  if (!state) return <p className="agent-public agent-public--empty">尚未形成公开策略</p>;
  const decision = state.lastDecision;
  const showRules = !compact && state.strategyRules.length > 0;
  return <div className={`agent-public${compact ? " agent-public--compact" : ""}`}>
    <div className="agent-public__status">
      <span className={decision?.source === "fallback" ? "is-fallback" : "is-model"} />
      {decision
        ? decision.source === "model"
          ? "最近一次由模型完成"
          : decision.source === "candidate"
            ? "最近一次由候选策略完成"
            : FALLBACK_LABEL[decision.fallbackReason ?? ""] ?? "已采用安全策略"
        : `公开策略 v${state.strategyVersion}`}
    </div>
    {showRules && <ul className="agent-public__rules">
      {state.strategyRules.slice(0, 3).map((rule) =>
        reveal
          ? <AgreementRow key={rule.id} rule={rule} reveal={reveal} />
          : <li key={rule.id}>
              <strong>{ruleLabel(rule)}</strong>
              {rule.targetSegments?.length ? <span>区段 {rule.targetSegments.map((segment) => segment + 1).join("、")}</span> : null}
              {rule.targetSeatIds.length ? <span>座位 {rule.targetSeatIds.join("、")}</span> : null}
            </li>
      )}
    </ul>}
  </div>;
}

export const agentStateForSeat = (states: PublicAgentSeatState[], seatId: SeatId) => states.find((state) => state.seatId === seatId);
