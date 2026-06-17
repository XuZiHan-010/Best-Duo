import type { Condition } from "@take-time/shared";
import { conditionToText } from "./conditionText.js";

// 条件内部用 0-based segment（运行时 placements 索引）。本文件全部沿用 0-based，
// 展示交给调用方（ClockBoard 按扇区下标渲染）。

/** 结构化图标负载：ClockBoard 据此画内联 SVG，无则回退到 `short` 文本。 */
export type SegmentBadgeIcon =
  | { type: "colors"; black: number; white: number }
  | { type: "order"; order: number }
  | { type: "cards"; count: number; prefix?: "≥" | "≤" | "=" };

export interface SegmentBadge {
  /** 钟面边缘的极简文案，如 "12–16"、"≤3张"；也作图标徽标的 a11y / 无图标回退。 */
  short: string;
  /** 完整中文说明（复用 conditionToText），用于 tooltip / aria-label。 */
  full: string;
  /** 视觉分类，便于样式区分（不只靠颜色，文案本身已自解释）。 */
  kind: "count" | "sum" | "color" | "order" | "other";
  /** 可选图标负载；存在时优先画 SVG 而非 `short` 文本。 */
  icon?: SegmentBadgeIcon;
}

export interface SegmentHints {
  /** 0-based 扇区下标。 */
  segment: number;
  badges: SegmentBadge[];
}

/** 把某个绑定单个扇区的条件转成极简徽标；多段/全局类返回 null。 */
function badgeForCondition(c: Condition): { segment: number; badge: SegmentBadge } | null {
  const full = conditionToText(c);
  switch (c.type) {
    case "min-cards":
      return { segment: c.segment, badge: { short: `≥${c.count}张`, full, kind: "count", icon: { type: "cards", count: c.count, prefix: "≥" } } };
    case "max-cards":
      return { segment: c.segment, badge: { short: `≤${c.count}张`, full, kind: "count", icon: { type: "cards", count: c.count, prefix: "≤" } } };
    // exact-cards 和 segment-colors 改为段内幽灵卡显示（ClockBoard → ClockSegment hintCards），不再生成外圈徽标。
    case "exact-cards":
    case "segment-colors":
      return null;
    case "sum-equals":
      return { segment: c.segment, badge: { short: `=${c.value}`, full, kind: "sum" } };
    case "sum-range":
      return { segment: c.segment, badge: { short: `${c.min}–${c.max}`, full, kind: "sum" } };
    case "parity":
      return { segment: c.segment, badge: { short: c.parity === "odd" ? "奇" : "偶", full, kind: "sum" } };
    case "all-distinct":
      return { segment: c.segment, badge: { short: "各不同", full, kind: "other" } };
    // 出牌顺序：在目标扇区常驻「第 N 张落这里」徽标（迷你卡片 + 序号角标）。
    case "placement-order":
      return {
        segment: c.segment,
        badge: { short: `第${c.order}张`, full, kind: "order", icon: { type: "order", order: c.order } },
      };
    // 多段 / 全局类不生成扇区徽标。
    case "all-nonempty":
    case "non-decreasing":
    case "non-increasing":
    case "adjacent-diff":
    case "max-sum-each":
      return null;
    default: {
      const _exhaustive: never = c;
      void _exhaustive;
      return null;
    }
  }
}

/** 按 0-based 扇区聚合所有单扇区条件的徽标（同一扇区可有多个）。 */
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

/**
 * 若存在 `placement-order` 条件要求「第 nextOrder 张必须落在某区」，返回其 0-based 扇区，
 * 否则返回 null。nextOrder 为 1-based 全局出牌序号。
 */
export function forcedSegmentForOrder(conditions: Condition[], nextOrder: number): number | null {
  for (const c of conditions) {
    if (c.type === "placement-order" && c.order === nextOrder) return c.segment;
  }
  return null;
}
