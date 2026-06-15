export interface DealRule {
  handSize: number;
  revealRemainingAfter: number | null;
  initialVisibleMask(handSize: number): boolean[];
}

export const dealRules: Record<2 | 3 | 4, DealRule> = {
  2: {
    handSize: 6,
    revealRemainingAfter: 2,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, (_value, index) => index > 0 && index < handSize - 1)
  },
  3: {
    handSize: 4,
    revealRemainingAfter: null,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, () => true)
  },
  4: {
    handSize: 3,
    revealRemainingAfter: null,
    initialVisibleMask: (handSize) => Array.from({ length: handSize }, () => true)
  }
};
