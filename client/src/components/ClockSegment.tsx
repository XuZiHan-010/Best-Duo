import React from "react";
import type { PublicPlacedCard } from "@take-time/shared";

interface ClockSegmentProps {
  cards: PublicPlacedCard[];
  pctX: number;
  pctY: number;
  interactive: boolean;
  segmentIndex: number;
  // 出牌顺序约束生效时，非目标扇区被锁定：压暗、不可点、移出 tab 顺序。
  locked?: boolean;
  animDelay?: number;   // ms — used in reveal phase for stagger
  onClick?: () => void;
}

function PlacedMiniCard({ card }: { card: PublicPlacedCard }) {
  if (card.revealed && card.color) {
    const cls = card.color === "white" ? "placed-card placed-card--white" : "placed-card placed-card--black";
    return <span className={cls}>{card.value}</span>;
  }
  return <span className="placed-card placed-card--blind">?</span>;
}

export function ClockSegment({
  cards,
  pctX,
  pctY,
  interactive,
  segmentIndex,
  locked,
  animDelay,
  onClick,
}: ClockSegmentProps) {
  if (cards.length === 0 && !interactive && !locked) return null;

  // Enter / Space activate the segment like a button; Space must not scroll the page.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive || !onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={[
        "clock-segment-overlay",
        interactive ? "clock-segment-overlay--interactive" : "",
        cards.length === 0 && interactive ? "clock-segment-overlay--empty" : "",
        locked ? "clock-segment-overlay--locked" : "",
        animDelay !== undefined ? "clock-segment-overlay--reveal" : "",
      ].filter(Boolean).join(" ")}
      style={{
        left: `${pctX}%`,
        top: `${pctY}%`,
        ...(animDelay !== undefined ? { animationDelay: `${animDelay}ms` } : {}),
      }}
      data-segment={segmentIndex}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={locked ? "true" : undefined}
      aria-label={interactive ? `放入区段 ${segmentIndex + 1}` : `区段 ${segmentIndex + 1}，${cards.length} 张牌`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="clock-segment-overlay__cards">
        {cards.map((c) => (
          <PlacedMiniCard key={c.id} card={c} />
        ))}
      </div>
      {cards.length > 0 && (
        <span className="clock-segment-overlay__count" aria-hidden="true">
          {cards.length} 张
        </span>
      )}
    </div>
  );
}
