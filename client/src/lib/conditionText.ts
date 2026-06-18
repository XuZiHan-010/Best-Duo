import type { Condition } from "@take-time/shared";

// 条件内部用 0-based segment（运行时 placements 索引），展示需转回人类口径 1-based。
const seg = (n: number) => n + 1;

export function conditionToText(c: Condition): string {
  switch (c.type) {
    case "all-nonempty":
      return "所有区段至少 1 张牌";
    case "min-cards":
      return `区${seg(c.segment)} 至少 ${c.count} 张`;
    case "max-cards":
      return `区${seg(c.segment)} 最多 ${c.count} 张`;
    case "exact-cards":
      return `区${seg(c.segment)} 恰好 ${c.count} 张`;
    case "sum-equals":
      return `区${seg(c.segment)} 总和恰好 ${c.value}`;
    case "sum-range":
      return `区${seg(c.segment)} 总和 ${c.min}–${c.max}`;
    case "parity":
      return `区${seg(c.segment)} 总和为${c.parity === "odd" ? "奇" : "偶"}数`;
    case "non-decreasing":
      return `区${c.segments.map(seg).join(" ≤ 区")} 依次非递减`;
    case "non-increasing":
      return `区${c.segments.map(seg).join(" ≥ 区")} 依次非递增`;
    case "adjacent-diff":
      return `区${seg(c.a)} 与区${seg(c.b)} 总和差 ≤ ${c.maxDiff}`;
    case "placement-order":
      return `第 ${c.order} 张打出的牌必须落在区${seg(c.segment)}`;
    case "segment-colors":
      return `区${seg(c.segment)} 恰好 ${c.black} 黑 + ${c.white} 白`;
    case "min-color-cards":
      return `区${seg(c.segment)} 至少 ${c.count} 张${c.color === "black" ? "黑牌" : "白牌"}`;
    case "all-distinct":
      return `区${seg(c.segment)} 内各牌数值互不相同`;
    case "has-duplicate-value":
      return `区${seg(c.segment)} 内至少有两张牌数值相同`;
    case "max-sum-each":
      return `每区段总和 ≤ ${c.value}`;
    default:
      const _exhaustive: never = c;
      return JSON.stringify(_exhaustive);
  }
}
