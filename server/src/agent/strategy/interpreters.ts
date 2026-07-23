import type { PublicHandCard, TurnStrategyRuleView, TurnView } from "@take-time/shared";
import { executableRuleParametersValid } from "./ruleSchemas.js";

export interface StrategyAction {
  cardId: string;
  segment: number;
}

export interface RuleRelaxation {
  ruleId: string;
  reason: "no_executable_candidate";
  beforeCount: number;
  afterCount: number;
}

export const executableRulesForSeat = (view: TurnView): TurnStrategyRuleView[] =>
  (view.memory?.lockedSeatStrategy?.rules ?? []).filter(
    (rule) =>
      rule.strength !== "unresolved" &&
      (rule.targetSeatIds.length === 0 || rule.targetSeatIds.includes(view.seatId)) &&
      executableRuleParametersValid(rule)
  );

const cardFor = (view: TurnView, action: StrategyAction): PublicHandCard | undefined =>
  view.hand.find((card) => card.id === action.cardId);

const appliesToSegment = (rule: TurnStrategyRuleView, segment: number): boolean =>
  !rule.targetSegments?.length || rule.targetSegments.includes(segment);

const currentPlayOrder = (view: TurnView): number =>
  view.placements.reduce((total, cards) => total + cards.length, 0) + 1;

const hardRuleAllows = (view: TurnView, rule: TurnStrategyRuleView, action: StrategyAction): boolean => {
  const card = cardFor(view, action);
  const parameters = rule.parameters as Record<string, unknown>;
  switch (rule.type) {
    case "segment_assignment":
      return appliesToSegment(rule, action.segment);
    case "avoid_segment":
      return !appliesToSegment(rule, action.segment);
    case "value_band": {
      if (!appliesToSegment(rule, action.segment) || typeof card?.value !== "number") return true;
      return card.value >= Number(parameters.min) && card.value <= Number(parameters.max);
    }
    case "color_allocation": {
      if (!appliesToSegment(rule, action.segment) || !card?.color) return true;
      const targetColor = parameters.color;
      const current = (view.placements[action.segment] ?? []).filter((placed) => placed.color === targetColor).length;
      const exact = typeof parameters.exact === "number" ? parameters.exact : undefined;
      const min = typeof parameters.min === "number" ? parameters.min : exact;
      const max = typeof parameters.max === "number" ? parameters.max : exact;
      if (max !== undefined && current >= max && card.color === targetColor) return false;
      if (min !== undefined && current < min && card.color !== targetColor) return false;
      return true;
    }
    case "placement_order":
      return currentPlayOrder(view) !== Number(parameters.order) || appliesToSegment(rule, action.segment);
    case "reserve_capacity":
      return !appliesToSegment(rule, action.segment) ||
        (view.placements[action.segment]?.length ?? 0) < Number(parameters.maxCards);
    case "hint_policy":
    case "card_property_preference":
    case "custom":
      return true;
  }
};

export const applyHardStrategyRules = (
  view: TurnView,
  actions: StrategyAction[]
): { actions: StrategyAction[]; appliedRuleIds: string[]; relaxations: RuleRelaxation[] } => {
  let survivors = actions;
  const appliedRuleIds: string[] = [];
  const relaxations: RuleRelaxation[] = [];
  for (const rule of executableRulesForSeat(view).filter((candidate) => candidate.strength === "hard_commitment")) {
    const kept = survivors.filter((action) => hardRuleAllows(view, rule, action));
    if (kept.length > 0) {
      if (kept.length < survivors.length) appliedRuleIds.push(rule.id);
      survivors = kept;
      continue;
    }
    relaxations.push({
      ruleId: rule.id,
      reason: "no_executable_candidate",
      beforeCount: survivors.length,
      afterCount: survivors.length
    });
  }
  return { actions: survivors, appliedRuleIds, relaxations };
};

export const scoreStrategyRules = (
  view: TurnView,
  card: PublicHandCard,
  segment: number
): Array<{ source: string; contribution: number; ruleId: string; detail?: string }> => {
  const components: Array<{ source: string; contribution: number; ruleId: string; detail?: string }> = [];
  const order = currentPlayOrder(view);
  for (const rule of executableRulesForSeat(view)) {
    const target = appliesToSegment(rule, segment);
    const parameters = rule.parameters as Record<string, unknown>;
    const add = (source: string, contribution: number, detail?: string) =>
      components.push({ source, contribution, ruleId: rule.id, ...(detail ? { detail } : {}) });
    switch (rule.type) {
      case "segment_assignment":
        if (target) add("assignment", 12, `S${segment + 1}`);
        break;
      case "avoid_segment":
        if (target && rule.strength !== "hard_commitment") add("avoid_segment", -14, `S${segment + 1}`);
        break;
      case "value_band":
        if (target && typeof card.value === "number") {
          const inBand = card.value >= Number(parameters.min) && card.value <= Number(parameters.max);
          add("value_band", inBand ? 10 : -10);
        }
        break;
      case "color_allocation":
        if (target && card.color) {
          const desired = parameters.color;
          const current = (view.placements[segment] ?? []).filter((placed) => placed.color === desired).length;
          const exact = typeof parameters.exact === "number" ? parameters.exact : undefined;
          const min = typeof parameters.min === "number" ? parameters.min : exact;
          const max = typeof parameters.max === "number" ? parameters.max : exact;
          if (min !== undefined && current < min) add("color_allocation", card.color === desired ? 10 : -8);
          else if (max !== undefined && current >= max && card.color === desired) add("color_allocation", -10);
        }
        break;
      case "placement_order":
        if (order === Number(parameters.order)) add("placement_order", target ? 20 : -20);
        break;
      case "reserve_capacity":
        if (target) {
          const remaining = Number(parameters.maxCards) - (view.placements[segment]?.length ?? 0);
          add("reserve_capacity", remaining > 0 ? 3 : -12);
        }
        break;
      case "hint_policy":
      case "card_property_preference":
      case "custom":
        break;
    }
  }
  return components;
};

export const decideHintFromPolicy = (
  view: TurnView,
  cardId: string
): { intent: "yes" | "no"; appliedRuleIds: string[] } | null => {
  const card = view.hand.find((candidate) => candidate.id === cardId);
  const markerCount = Math.max(0, view.hintMarkers.total - view.hintMarkers.used);
  // 提示标记是全队共享资源。只有真人确认后升级的 hard_commitment
  // 才能确定性覆盖本手提示决定；strong_preference / suggestion 只能留在
  // 模型上下文中作为软偏好，不能在解释器层被悄悄提升为硬规则。
  for (const rule of executableRulesForSeat(view).filter(
    (candidate) => candidate.type === "hint_policy" && candidate.strength === "hard_commitment"
  )) {
    const parameters = rule.parameters as Record<string, unknown>;
    if (markerCount < Number(parameters.minMarkers ?? 1)) return { intent: "no", appliedRuleIds: [rule.id] };
    if (parameters.mode === "never") return { intent: "no", appliedRuleIds: [rule.id] };
    if (parameters.mode === "always_known" && typeof card?.value === "number") {
      return { intent: "yes", appliedRuleIds: [rule.id] };
    }
    if (parameters.mode === "high_information" && typeof card?.value === "number") {
      return { intent: card.value <= 2 || card.value >= 11 ? "yes" : "no", appliedRuleIds: [rule.id] };
    }
  }
  return null;
};
