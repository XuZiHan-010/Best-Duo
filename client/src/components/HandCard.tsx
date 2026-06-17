import React from "react";
import type { PublicHandCard } from "@take-time/shared";

interface HandCardProps {
  card: PublicHandCard;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function HandCard({ card, selected, disabled, onClick }: HandCardProps) {
  const isBlind = !card.visibleToOwner;
  const color   = card.color;

  const cls = [
    "hand-card",
    isBlind              ? "hand-card--blind"    : color === "white" ? "hand-card--white" : "hand-card--black",
    selected             ? "hand-card--selected"  : "",
    disabled             ? "hand-card--disabled"  : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      className={cls}
      onClick={disabled ? undefined : onClick}
      aria-pressed={selected}
      aria-label={isBlind ? "盲牌" : `${color === "white" ? "白" : "黑"}牌 ${card.value}`}
      disabled={disabled}
    >
      {isBlind ? "?" : card.value}
    </button>
  );
}
