import type { Condition } from "@take-time/shared";

const seg = (n: number) => n + 1;

export function conditionToText(condition: Condition): string {
  switch (condition.type) {
    case "all-nonempty":
      return "所有区段至少 1 张牌";
    case "min-cards":
      return `区 ${seg(condition.segment)} 至少 ${condition.count} 张`;
    case "max-cards":
      return `区 ${seg(condition.segment)} 至多 ${condition.count} 张`;
    case "exact-cards":
      return `区 ${seg(condition.segment)} 恰好 ${condition.count} 张`;
    case "sum-equals":
      return `区 ${seg(condition.segment)} 总和恰好 ${condition.value}`;
    case "sum-range":
      return `区 ${seg(condition.segment)} 总和 ${condition.min}-${condition.max}`;
    case "parity":
      return `区 ${seg(condition.segment)} 总和为${condition.parity === "odd" ? "奇" : "偶"}数`;
    case "closest-to-value":
      return `区 ${seg(condition.segment)} 唯一最接近 ${condition.value}`;
    case "non-decreasing": {
      const segments = condition.segments.map((segment) => `区 ${seg(segment)}`);
      return `${segments.join(" <= ")} 依次非递减`;
    }
    case "non-increasing": {
      const segments = condition.segments.map((segment) => `区 ${seg(segment)}`);
      return `${segments.join(" >= ")} 依次非递增`;
    }
    case "adjacent-diff":
      return `区 ${seg(condition.a)} 与区 ${seg(condition.b)} 总和差 <= ${condition.maxDiff}`;
    case "placement-order":
      return `第 ${condition.order} 张打出的牌必须落在区 ${seg(condition.segment)}`;
    case "segment-colors":
      if (condition.black === 0) return `区 ${seg(condition.segment)} 恰好 ${condition.white} 张白牌`;
      if (condition.white === 0) return `区 ${seg(condition.segment)} 恰好 ${condition.black} 张黑牌`;
      return `区 ${seg(condition.segment)} 恰好 ${condition.black} 黑 + ${condition.white} 白`;
    case "min-color-cards":
      return `区 ${seg(condition.segment)} 至少 ${condition.count} 张${condition.color === "black" ? "黑牌" : "白牌"}`;
    case "max-color-cards":
      return `区 ${seg(condition.segment)} 至多 ${condition.count} 张${condition.color === "black" ? "黑牌" : "白牌"}`;
    case "forbidden-values":
      return `区 ${seg(condition.segment)} 不能放 ${condition.values.join(", ")}`;
    case "all-distinct":
      return `区 ${seg(condition.segment)} 内各牌数值互不相同`;
    case "has-duplicate-value":
      return `区 ${seg(condition.segment)} 内至少有两张牌数值相同`;
    case "max-sum-each":
      return `每区段总和 <= ${condition.value}`;
  }
}
