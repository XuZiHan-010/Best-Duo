import React from "react";
import type { PublicHandCard } from "@take-time/shared";
import { HandCard } from "./HandCard.js";

interface HandRailProps {
  cards: PublicHandCard[];
  selectedCardId: string | null;
  disabled: boolean;
  onSelect: (cardId: string) => void;
}

export function HandRail({ cards, selectedCardId, disabled, onSelect }: HandRailProps) {
  if (cards.length === 0) {
    return <div className="hand-rail hand-rail--empty">手牌已出完</div>;
  }

  return (
    <div className="hand-rail" aria-label="我的手牌">
      {cards.map((card) => (
        <HandCard
          key={card.id}
          card={card}
          selected={card.id === selectedCardId}
          disabled={disabled}
          onClick={() => onSelect(card.id === selectedCardId ? "" : card.id)}
        />
      ))}
    </div>
  );
}
