// client/src/components/ClockBoard.tsx
import React from "react";
import type { PublicPlacedCard } from "@take-time/shared";

interface ClockBoardProps {
  centerCap: number | null;
  placements: PublicPlacedCard[][];   // M2 传 [] ，M3 填充
  interactive?: boolean;              // M3 出牌阶段开启
  onSegmentClick?: (segment: number) => void; // M3 用
}

const CX = 120, CY = 120;
const R_OUTER = 85;
const R_INNER = 28;
const R_TICK  = 93;
const R_LABEL = 100;

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

const SEG_LABELS = ["S1", "S2", "S3", "S4", "S5", "S6"];

export function ClockBoard({
  centerCap,
  placements,
  interactive,
  onSegmentClick,
}: ClockBoardProps) {
  return (
    <div className="clock-board">
      <svg
        viewBox="0 0 240 240"
        width="100%"
        height="100%"
        aria-label="时钟盘"
      >
        {/* 底层背景圆 */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="#0c1320" stroke="#2a3550" strokeWidth="1" />

        {/* 6 个扇形底色（交替深浅，辅助区分） */}
        {Array.from({ length: 6 }).map((_, i) => (
          <path
            key={i}
            d={sectorPath(i * 60, R_OUTER)}
            fill="#C9A24B"
            opacity={i % 2 === 0 ? 0.07 : 0.04}
            className={interactive ? "clock-board__sector--interactive" : undefined}
            onClick={interactive && onSegmentClick ? () => onSegmentClick(i + 1) : undefined}
            role={interactive ? "button" : undefined}
            aria-label={interactive ? `区段 ${i + 1}` : undefined}
            style={{ cursor: interactive ? "pointer" : undefined }}
          />
        ))}

        {/* 外刻度环 */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="#C9A24B" strokeWidth="1.2" opacity="0.3" />

        {/* 12 刻度线（每 30°） */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1={px(R_OUTER, i * 30).toFixed(2)} y1={py(R_OUTER, i * 30).toFixed(2)}
            x2={px(R_TICK,  i * 30).toFixed(2)} y2={py(R_TICK,  i * 30).toFixed(2)}
            stroke="#C9A24B" strokeWidth="1" opacity="0.45"
          />
        ))}

        {/* 6 段分割线（从中心圆边缘到外圈，每 60°） */}
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={i}
            x1={px(R_INNER, i * 60).toFixed(2)} y1={py(R_INNER, i * 60).toFixed(2)}
            x2={px(R_OUTER, i * 60).toFixed(2)} y2={py(R_OUTER, i * 60).toFixed(2)}
            stroke="#C9A24B" strokeWidth="1" opacity="0.4"
          />
        ))}

        {/* S1–S6 标签（外圈，每段弧中点） */}
        {SEG_LABELS.map((label, i) => {
          const midDeg = i * 60 + 30;
          return (
            <text
              key={i}
              x={px(R_LABEL, midDeg).toFixed(2)}
              y={py(R_LABEL, midDeg).toFixed(2)}
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

        {/* centerCap：数字或 ∞ */}
        <text
          x={CX} y={CY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="16"
          fontWeight="700"
          fill="#C9A24B"
          fontFamily="monospace"
        >
          {centerCap === null ? "∞" : String(centerCap)}
        </text>
      </svg>
    </div>
  );
}
