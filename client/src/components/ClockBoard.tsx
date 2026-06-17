import React from "react";
import type { Condition, PublicPlacedCard } from "@take-time/shared";
import { ClockSegment } from "./ClockSegment.js";
import { segmentBadges } from "../lib/segmentHints.js";
import type { SegmentBadge } from "../lib/segmentHints.js";
import { conditionToText } from "../lib/conditionText.js";

type HintCardColor = "black" | "white" | "neutral";
interface SegmentHintStack { cards: HintCardColor[]; tip: string; }

interface ClockBoardProps {
  // number = 每段上限；null/省略 = 官方默认 24；"inf" = ∞（无上限）。
  centerCap: number | "inf" | null;
  placements: PublicPlacedCard[][];
  interactive?: boolean;
  cardSelected?: boolean;
  revealMode?: boolean;   // stagger animation in reveal phase
  // 关卡条件：用于在扇区边缘渲染极简徽标（点数/张数等单扇区约束）。
  conditions?: Condition[];
  // 出牌顺序约束生效时强制的 0-based 目标扇区：仅它可点，其余锁定。null = 无强制。
  forcedSegment?: number | null;
  onSegmentClick?: (segment: number) => void;
}

const CX = 120, CY = 120;
const R_OUTER = 85;
const R_INNER = 28;
const R_TICK  = 93;
const R_CENTROID = (R_INNER + R_OUTER) / 2;
const R_HINT  = 124;   // 边缘徽标半径：刻度环外侧，与 S 标签留出一点间距

function sinDeg(d: number) { return Math.sin(d * Math.PI / 180); }
function cosDeg(d: number) { return Math.cos(d * Math.PI / 180); }
function px(r: number, a: number) { return CX + r * sinDeg(a); }
function py(r: number, a: number) { return CY - r * cosDeg(a); }

function sectorPath(startDeg: number, r: number): string {
  const end = startDeg + 60;
  return [
    `M ${CX} ${CY}`,
    `L ${px(r, startDeg).toFixed(2)} ${py(r, startDeg).toFixed(2)}`,
    `A ${r} ${r} 0 0 1 ${px(r, end).toFixed(2)} ${py(r, end).toFixed(2)}`,
    "Z",
  ].join(" ");
}

// Segment centroids as percentage of 240×240 viewBox
const SEGMENT_POSITIONS = Array.from({ length: 6 }).map((_, i) => {
  const midDeg = i * 60 + 30;
  return {
    pctX: (px(R_CENTROID, midDeg) / 240) * 100,
    pctY: (py(R_CENTROID, midDeg) / 240) * 100,
  };
});

// Hint badge anchors at the outer rim, just beyond each S label.
const HINT_POSITIONS = Array.from({ length: 6 }).map((_, i) => {
  const midDeg = i * 60 + 30;
  return {
    pctX: (px(R_HINT, midDeg) / 240) * 100,
    pctY: (py(R_HINT, midDeg) / 240) * 100,
  };
});

// 持久幽灵卡堆锚点：在每个 S 标签外侧、与标签留出一点间距。
const R_HINT_CARD = 122;
const HINT_CARD_POSITIONS = Array.from({ length: 6 }).map((_, i) => {
  const midDeg = i * 60 + 30;
  return {
    pctX: (px(R_HINT_CARD, midDeg) / 240) * 100,
    pctY: (py(R_HINT_CARD, midDeg) / 240) * 100,
  };
});

const SEG_LABELS = ["S1", "S2", "S3", "S4", "S5", "S6"];

// 迷你卡片 SVG — 宽18×高25，与游戏卡牌同色系。
function MiniCardIcon({ tone, label }: { tone: "black" | "white" | "neutral"; label?: string }) {
  const fillFrom = tone === "white" ? "#ECE6D8" : tone === "black" ? "#1a1a2e" : "#243049";
  const fillTo   = tone === "white" ? "#C8C0B0" : tone === "black" ? "#0d0d1a" : "#141d30";
  const stroke   = tone === "white" ? "#B0A898" : tone === "black" ? "#3a3a5c" : "#C9A24B";
  const ink      = tone === "white" ? "#1a1a1a" : "#ECE6D8";
  const gid = `mc-${tone}`;
  return (
    <svg className="clock-hint__icon" viewBox="0 0 18 25" width="18" height="25" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={fillFrom} />
          <stop offset="1" stopColor={fillTo} />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="16.5" height="23.5" rx="3" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.2" />
      {label && (
        <text x="9" y="13" textAnchor="middle" dominantBaseline="central" fontFamily="monospace" fontSize="9" fontWeight="700" fill={ink}>
          {label}
        </text>
      )}
    </svg>
  );
}

// 徽标内容：有 icon 负载画 SVG，否则回退到 short 文本。
function BadgeContent({ badge }: { badge: SegmentBadge }) {
  const icon = badge.icon;
  if (!icon) return <>{badge.short}</>;

  if (icon.type === "colors") {
    return (
      <span className="clock-hint__icons">
        {icon.black > 0 && <MiniCardIcon tone="black" label={icon.black > 1 ? String(icon.black) : undefined} />}
        {icon.white > 0 && <MiniCardIcon tone="white" label={icon.white > 1 ? String(icon.white) : undefined} />}
      </span>
    );
  }

  if (icon.type === "cards") {
    // 超过 4 张时用「N×卡片」避免排列过宽
    const showStacked = icon.count > 4;
    return (
      <span className="clock-hint__icons">
        {icon.prefix && <span className="clock-hint__card-prefix">{icon.prefix}</span>}
        {showStacked ? (
          <>
            <MiniCardIcon tone="neutral" />
            <span className="clock-hint__card-prefix">×{icon.count}</span>
          </>
        ) : (
          Array.from({ length: icon.count }).map((_, i) => (
            <MiniCardIcon key={i} tone="neutral" />
          ))
        )}
      </span>
    );
  }

  // order：中性迷你卡片 + 右上角序号角标
  return (
    <span className="clock-hint__icons clock-hint__icons--order">
      <MiniCardIcon tone="neutral" />
      <span className="clock-hint__order-num">{icon.order}</span>
    </span>
  );
}

/** 从 exact-cards / segment-colors 条件推导出常驻幽灵卡堆（0-based segment → 卡色列表 + 完整中文提示）。*/
function buildSegmentHintCards(conditions: Condition[]): Map<number, SegmentHintStack> {
  const map = new Map<number, SegmentHintStack>();
  for (const c of conditions) {
    if (c.type === "exact-cards") {
      map.set(c.segment, {
        cards: Array.from({ length: c.count }, () => "neutral" as HintCardColor),
        tip: conditionToText(c),
      });
    } else if (c.type === "segment-colors") {
      map.set(c.segment, {
        cards: [
          ...Array.from({ length: c.black }, () => "black" as HintCardColor),
          ...Array.from({ length: c.white }, () => "white" as HintCardColor),
        ],
        tip: conditionToText(c),
      });
    }
  }
  return map;
}

export function ClockBoard({
  centerCap,
  placements,
  interactive,
  cardSelected,
  revealMode,
  conditions,
  forcedSegment,
  onSegmentClick,
}: ClockBoardProps) {
  // 0-based 扇区 → 该扇区的边缘徽标（排除已被段内幽灵卡取代的 count/color 类型）。
  const hintsBySegment = new Map<number, ReturnType<typeof segmentBadges>[number]["badges"]>();
  if (conditions) {
    for (const h of segmentBadges(conditions)) hintsBySegment.set(h.segment, h.badges);
  }
  // 段内幽灵卡提示（exact-cards / segment-colors）
  const segmentHintCards = conditions ? buildSegmentHintCards(conditions) : new Map<number, SegmentHintStack>();
  const hasForced = forcedSegment !== null && forcedSegment !== undefined;
  return (
    <div className="clock-board">
      <svg
        viewBox="0 0 240 240"
        width="100%"
        height="100%"
        aria-label="时钟盘"
        aria-hidden={interactive ? "true" : undefined}
      >
        {/* 底层背景圆 */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="#0c1320" stroke="#2a3550" strokeWidth="1" />

        {/* 6 个扇形底色 */}
        {Array.from({ length: 6 }).map((_, i) => (
          <path
            key={i}
            d={sectorPath(i * 60, R_OUTER)}
            fill="#C9A24B"
            opacity={
              interactive && cardSelected
                ? 0.12   // 全段青色可点时加亮
                : i % 2 === 0 ? 0.07 : 0.04
            }
          />
        ))}

        {/* 外刻度环 */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="#C9A24B" strokeWidth="1.2" opacity="0.3" />

        {/* 12 刻度线 */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1={px(R_OUTER, i * 30).toFixed(2)} y1={py(R_OUTER, i * 30).toFixed(2)}
            x2={px(R_TICK,  i * 30).toFixed(2)} y2={py(R_TICK,  i * 30).toFixed(2)}
            stroke="#C9A24B" strokeWidth="1" opacity="0.45"
          />
        ))}

        {/* 6 段分割线 */}
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={i}
            x1={px(R_INNER, i * 60).toFixed(2)} y1={py(R_INNER, i * 60).toFixed(2)}
            x2={px(R_OUTER, i * 60).toFixed(2)} y2={py(R_OUTER, i * 60).toFixed(2)}
            stroke="#C9A24B" strokeWidth="1" opacity="0.4"
          />
        ))}

        {/* S1–S6 标签 */}
        {SEG_LABELS.map((label, i) => {
          const midDeg = i * 60 + 30;
          return (
            <text
              key={i}
              x={px(R_TICK + 7, midDeg).toFixed(2)}
              y={py(R_TICK + 7, midDeg).toFixed(2)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="10"
              fontWeight={i === 0 ? "700" : "600"}
              fill={i === 0 ? "#C9A24B" : "#9AA4B8"}
              fontFamily="monospace"
            >
              {label}
            </text>
          );
        })}

        {/* 中心圆 */}
        <circle cx={CX} cy={CY} r={R_INNER} fill="#121b2c" stroke="#C9A24B" strokeWidth="1.5" opacity="0.7" />

        {/* centerCap */}
        <text
          x={CX} y={CY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="16"
          fontWeight="700"
          fill="#C9A24B"
          fontFamily="monospace"
        >
          {centerCap === "inf" ? "∞" : String(centerCap ?? 24)}
        </text>
      </svg>

      {/* HTML overlay: one ClockSegment per segment */}
      {SEGMENT_POSITIONS.map((pos, i) => {
        // 默认全段可交互；出牌顺序约束生效时只有目标扇区可点，其余锁定。
        const baseInteractive = !!(interactive && cardSelected);
        const segInteractive = hasForced ? baseInteractive && i === forcedSegment : baseInteractive;
        const segLocked = hasForced && baseInteractive && i !== forcedSegment;
        return (
          <ClockSegment
            key={i}
            cards={placements[i] ?? []}
            pctX={pos.pctX}
            pctY={pos.pctY}
            interactive={segInteractive}
            locked={segLocked}
            segmentIndex={i}
            animDelay={revealMode ? i * 120 : undefined}
            // 0-based segment，与服务端 card:place / placements 索引对齐（展示性 +1 见 ClockSegment aria-label）
            onClick={onSegmentClick ? () => onSegmentClick(i) : undefined}
          />
        );
      })}

      {/* 扇区边缘条件徽标层 */}
      {HINT_POSITIONS.map((pos, i) => {
        const badges = hintsBySegment.get(i);
        if (!badges || badges.length === 0) return null;
        const isForced = hasForced && i === forcedSegment;
        return (
          <div
            key={i}
            className={`clock-hint${isForced ? " clock-hint--forced" : ""}`}
            style={{ left: `${pos.pctX}%`, top: `${pos.pctY}%` }}
          >
            {badges.map((b, j) => (
              <span
                key={j}
                className={`clock-hint__badge clock-hint__badge--${b.kind}`}
                tabIndex={0}
                aria-label={b.full}
                data-tip={b.full}
              >
                <BadgeContent badge={b} />
              </span>
            ))}
          </div>
        );
      })}

      {/* 持久幽灵卡堆层：exact-cards / segment-colors 在对应 S 标签旁常驻显示「需要几张/什么颜色」 */}
      {HINT_CARD_POSITIONS.map((pos, i) => {
        const stack = segmentHintCards.get(i);
        if (!stack || stack.cards.length === 0) return null;
        return (
          <div
            key={i}
            className="clock-hint-cards"
            style={{ left: `${pos.pctX}%`, top: `${pos.pctY}%` }}
            tabIndex={0}
            aria-label={stack.tip}
            data-tip={stack.tip}
          >
            {stack.cards.map((color, j) => (
              <span key={j} className={`clock-hint-card clock-hint-card--${color}`}>?</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
