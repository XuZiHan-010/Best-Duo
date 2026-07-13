import { handSizeForPlayerCount, type PlayerCount } from "@take-time/shared";

export interface DealRule {
  handSize: number;
  revealRemainingAfter: number | null;
  initialVisibleMask(handSize: number): boolean[];
}

export const dealRules: Record<PlayerCount, DealRule> = {
  2: {
    handSize: handSizeForPlayerCount(2),
    revealRemainingAfter: 2,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, (_value, index) => index > 0 && index < handSize - 1)
  },
  3: {
    handSize: handSizeForPlayerCount(3),
    revealRemainingAfter: null,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, () => true)
  },
  4: {
    handSize: handSizeForPlayerCount(4),
    revealRemainingAfter: null,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, () => true)
  }
};
