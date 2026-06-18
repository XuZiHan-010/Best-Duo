import type { Condition } from "@take-time/shared";
import { conditionToText } from "./conditionText.js";

export type SegmentBadgeIcon =
  | { type: "colors"; black: number; white: number }
  | { type: "order"; order: number }
  | { type: "cards"; count: number; prefix?: ">=" | "<=" | "=" };

export interface SegmentBadge {
  short: string;
  full: string;
  kind: "count" | "sum" | "color" | "order" | "other";
  icon?: SegmentBadgeIcon;
}

export interface SegmentHints {
  segment: number;
  badges: SegmentBadge[];
}

function badgeForCondition(c: Condition): { segment: number; badge: SegmentBadge } | null {
  const full = conditionToText(c);
  switch (c.type) {
    case "min-cards":
      return { segment: c.segment, badge: { short: `>=${c.count}张`, full, kind: "count", icon: { type: "cards", count: c.count, prefix: ">=" } } };
    case "max-cards":
      return { segment: c.segment, badge: { short: `<=${c.count}张`, full, kind: "count", icon: { type: "cards", count: c.count, prefix: "<=" } } };
    case "min-color-cards":
      return { segment: c.segment, badge: { short: `>=${c.count}${c.color === "black" ? "黑" : "白"}`, full, kind: "color" } };
    case "max-color-cards":
      return { segment: c.segment, badge: { short: `<=${c.count}${c.color === "black" ? "黑" : "白"}`, full, kind: "color" } };
    case "sum-equals":
      return { segment: c.segment, badge: { short: `=${c.value}`, full, kind: "sum" } };
    case "sum-range":
      return { segment: c.segment, badge: { short: `${c.min}-${c.max}`, full, kind: "sum" } };
    case "parity":
      return { segment: c.segment, badge: { short: c.parity === "odd" ? "奇" : "偶", full, kind: "sum" } };
    case "closest-to-value":
      return { segment: c.segment, badge: { short: `近${c.value}`, full, kind: "sum" } };
    case "all-distinct":
      return { segment: c.segment, badge: { short: "各不同", full, kind: "other" } };
    case "has-duplicate-value":
      return { segment: c.segment, badge: { short: "同值", full, kind: "other" } };
    case "forbidden-values":
      return { segment: c.segment, badge: { short: `禁${c.values.join("/")}`, full, kind: "other" } };
    case "placement-order":
      return {
        segment: c.segment,
        badge: { short: `第${c.order}张`, full, kind: "order", icon: { type: "order", order: c.order } }
      };
    case "exact-cards":
    case "segment-colors":
    case "all-nonempty":
    case "non-decreasing":
    case "non-increasing":
    case "adjacent-diff":
    case "max-sum-each":
      return null;
  }
}

export function segmentBadges(conditions: Condition[]): SegmentHints[] {
  const bySegment = new Map<number, SegmentBadge[]>();
  for (const c of conditions) {
    const entry = badgeForCondition(c);
    if (!entry) continue;
    const list = bySegment.get(entry.segment) ?? [];
    list.push(entry.badge);
    bySegment.set(entry.segment, list);
  }
  return [...bySegment.entries()]
    .sort(([a], [b]) => a - b)
    .map(([segment, badges]) => ({ segment, badges }));
}

export function forcedSegmentForOrder(conditions: Condition[], nextOrder: number): number | null {
  for (const c of conditions) {
    if (c.type === "placement-order" && c.order === nextOrder) return c.segment;
  }
  return null;
}
