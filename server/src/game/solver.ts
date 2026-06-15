import type { Card, Challenge, Condition, SeatId } from "@take-time/shared";

export interface SolverCard extends Card {
  id: string;
  owner: SeatId;
}

interface SolverState {
  sums: number[];
  counts: number[];
  blackCounts: number[];
  whiteCounts: number[];
  valueSets: Array<Set<number>>;
  ownerSegmentCounts: Record<SeatId, number[]>;
  assignments: number[];
}

export interface SolveResult {
  solvable: boolean;
  assignments?: number[];
}

const segments = [0, 1, 2, 3, 4, 5];

const hasSubsetSum = (cards: SolverCard[], min: number, max: number, maxCards = cards.length) => {
  const possible = Array.from({ length: max + 1 }, () => Array.from({ length: maxCards + 1 }, () => false));
  possible[0][0] = true;
  for (const card of cards) {
    for (let sum = max - card.value; sum >= 0; sum -= 1) {
      for (let count = maxCards - 1; count >= 0; count -= 1) {
        if (possible[sum][count]) {
          possible[sum + card.value][count + 1] = true;
        }
      }
    }
  }

  for (let sum = min; sum <= max; sum += 1) {
    if (possible[sum].some(Boolean)) return true;
  }
  return false;
};

const tryFastSolve = (challenge: Challenge, cards: SolverCard[], seatIds: SeatId[]): SolveResult | null => {
  const conditions = challenge.conditions;
  const nonCenterConditions = conditions.filter((condition) => condition.type !== "max-sum-each");
  const maxSumEach = conditions.find((condition) => condition.type === "max-sum-each");
  const total = cards.reduce((sum, card) => sum + card.value, 0);

  if (
    nonCenterConditions.length === 1 &&
    (nonCenterConditions[0].type === "non-decreasing" || nonCenterConditions[0].type === "non-increasing") &&
    (!maxSumEach || total <= maxSumEach.value)
  ) {
    return { solvable: true };
  }

  const sumConditions = nonCenterConditions.filter((condition) => condition.type === "sum-equals" || condition.type === "sum-range");
  const otherConditions = nonCenterConditions.filter((condition) => condition.type !== "sum-equals" && condition.type !== "sum-range");
  if (
    sumConditions.length === 1 &&
    otherConditions.every((condition) => condition.type === "max-cards" || condition.type === "all-distinct") &&
    (!maxSumEach || total <= maxSumEach.value)
  ) {
    const condition = sumConditions[0];
    const maxCardsForSegment = otherConditions.find(
      (other) => other.type === "max-cards" && other.segment === condition.segment
    );
    const maxCards = maxCardsForSegment?.type === "max-cards" ? maxCardsForSegment.count : cards.length;
    const min = condition.type === "sum-equals" ? condition.value : condition.min;
    const max = condition.type === "sum-equals" ? condition.value : condition.max;
    return { solvable: hasSubsetSum(cards, min, max, maxCards) };
  }

  if (
    nonCenterConditions.every((condition) => condition.type === "placement-order" || condition.type === "segment-colors") &&
    (!maxSumEach || total <= maxSumEach.value)
  ) {
    const orderSegments = new Set(nonCenterConditions.filter((condition) => condition.type === "placement-order").map((condition) => condition.segment));
    const colorSegments = new Set(nonCenterConditions.filter((condition) => condition.type === "segment-colors").map((condition) => condition.segment));
    const overlaps = [...orderSegments].some((segment) => colorSegments.has(segment));
    if (!overlaps) {
      const requiredBlack = nonCenterConditions.reduce(
        (sum, condition) => sum + (condition.type === "segment-colors" ? condition.black : 0),
        0
      );
      const requiredWhite = nonCenterConditions.reduce(
        (sum, condition) => sum + (condition.type === "segment-colors" ? condition.white : 0),
        0
      );

      for (const startSeat of seatIds) {
        const startIndex = seatIds.indexOf(startSeat);
        const requiredOrders = Object.fromEntries(seatIds.map((seatId) => [seatId, 0])) as Record<SeatId, number>;
        let possible = true;
        const seenOrders = new Map<number, number>();

        for (const condition of nonCenterConditions) {
          if (condition.type !== "placement-order") continue;
          const existing = seenOrders.get(condition.order);
          if (existing !== undefined && existing !== condition.segment) {
            possible = false;
            break;
          }
          seenOrders.set(condition.order, condition.segment);
          const owner = seatIds[(startIndex + condition.order - 1) % seatIds.length];
          requiredOrders[owner] += 1;
        }

        if (!possible) continue;

        const maxRemainingBlack = seatIds.reduce((sum, seatId) => {
          const owned = cards.filter((card) => card.owner === seatId);
          const black = owned.filter((card) => card.color === "black").length;
          const white = owned.length - black;
          const minBlackConsumedByOrders = Math.max(0, requiredOrders[seatId] - white);
          return sum + black - minBlackConsumedByOrders;
        }, 0);
        const maxRemainingWhite = seatIds.reduce((sum, seatId) => {
          const owned = cards.filter((card) => card.owner === seatId);
          const black = owned.filter((card) => card.color === "black").length;
          const white = owned.length - black;
          const minWhiteConsumedByOrders = Math.max(0, requiredOrders[seatId] - black);
          return sum + white - minWhiteConsumedByOrders;
        }, 0);

        const remainingCards = cards.length - Object.values(requiredOrders).reduce((sum, count) => sum + count, 0);
        if (remainingCards >= requiredBlack + requiredWhite && maxRemainingBlack >= requiredBlack && maxRemainingWhite >= requiredWhite) {
          return { solvable: true };
        }
      }

      return { solvable: false };
    }
  }

  return null;
};

const getTargetSegments = (conditions: Condition[]) => {
  const targets = new Set<number>();
  for (const condition of conditions) {
    switch (condition.type) {
      case "min-cards":
      case "max-cards":
      case "exact-cards":
      case "sum-equals":
      case "sum-range":
      case "parity":
      case "segment-colors":
      case "all-distinct":
      case "placement-order":
        targets.add(condition.segment);
        break;
      case "adjacent-diff":
        targets.add(condition.a);
        targets.add(condition.b);
        break;
      case "non-decreasing":
      case "non-increasing":
        for (const segment of condition.segments) targets.add(segment);
        break;
      case "all-nonempty":
      case "max-sum-each":
        break;
    }
  }
  return [...targets, ...segments.filter((segment) => !targets.has(segment))];
};

const createState = (seatIds: SeatId[]): SolverState => ({
  sums: Array.from({ length: 6 }, () => 0),
  counts: Array.from({ length: 6 }, () => 0),
  blackCounts: Array.from({ length: 6 }, () => 0),
  whiteCounts: Array.from({ length: 6 }, () => 0),
  valueSets: Array.from({ length: 6 }, () => new Set<number>()),
  ownerSegmentCounts: Object.fromEntries(seatIds.map((seatId) => [seatId, Array.from({ length: 6 }, () => 0)])) as Record<
    SeatId,
    number[]
  >,
  assignments: []
});

const sumRemaining = (cards: SolverCard[], startIndex: number) =>
  cards.slice(startIndex).reduce((total, card) => total + card.value, 0);

const hasRequiredFutureCards = (state: SolverState, condition: Condition, cards: SolverCard[], nextIndex: number) => {
  switch (condition.type) {
    case "all-nonempty":
      return state.counts.filter((count) => count === 0).length <= cards.length - nextIndex;
    case "min-cards":
    case "exact-cards":
      return state.counts[condition.segment] + (cards.length - nextIndex) >= condition.count;
    case "sum-equals":
      return state.sums[condition.segment] <= condition.value && state.sums[condition.segment] + sumRemaining(cards, nextIndex) >= condition.value;
    case "sum-range":
      return state.sums[condition.segment] <= condition.max && state.sums[condition.segment] + sumRemaining(cards, nextIndex) >= condition.min;
    default:
      return true;
  }
};

const violatesUpperBounds = (state: SolverState, condition: Condition) => {
  switch (condition.type) {
    case "max-cards":
    case "exact-cards":
      return state.counts[condition.segment] > condition.count;
    case "sum-equals":
      return state.sums[condition.segment] > condition.value;
    case "sum-range":
      return state.sums[condition.segment] > condition.max;
    case "segment-colors":
      return state.blackCounts[condition.segment] > condition.black || state.whiteCounts[condition.segment] > condition.white;
    case "max-sum-each":
      return state.sums.some((sum) => sum > condition.value);
    default:
      return false;
  }
};

const canStillSatisfyPlacementOrder = (state: SolverState, conditions: Condition[], seatIds: SeatId[]) => {
  const orderSegments = new Map<number, number>();
  for (const condition of conditions) {
    if (condition.type !== "placement-order") continue;
    const existing = orderSegments.get(condition.order);
    if (existing !== undefined && existing !== condition.segment) return false;
    orderSegments.set(condition.order, condition.segment);
  }

  for (const startSeat of seatIds) {
    const startIndex = seatIds.indexOf(startSeat);
    const required: Record<SeatId, number[]> = Object.fromEntries(
      seatIds.map((seatId) => [seatId, Array.from({ length: 6 }, () => 0)])
    ) as Record<SeatId, number[]>;

    let possible = true;
    for (const [order, segment] of orderSegments.entries()) {
      if (order < 1 || order > 12) {
        possible = false;
        break;
      }
      const owner = seatIds[(startIndex + order - 1) % seatIds.length];
      required[owner][segment] += 1;
    }

    if (possible && seatIds.every((seatId) => required[seatId].every((count, segment) => state.ownerSegmentCounts[seatId][segment] >= count))) {
      return true;
    }
  }

  return orderSegments.size === 0;
};

const passesFinalConditions = (state: SolverState, conditions: Condition[], seatIds: SeatId[]) => {
  for (const condition of conditions) {
    switch (condition.type) {
      case "all-nonempty":
        if (!state.counts.every((count) => count > 0)) return false;
        break;
      case "min-cards":
        if (state.counts[condition.segment] < condition.count) return false;
        break;
      case "max-cards":
        if (state.counts[condition.segment] > condition.count) return false;
        break;
      case "exact-cards":
        if (state.counts[condition.segment] !== condition.count) return false;
        break;
      case "sum-equals":
        if (state.sums[condition.segment] !== condition.value) return false;
        break;
      case "sum-range":
        if (state.sums[condition.segment] < condition.min || state.sums[condition.segment] > condition.max) return false;
        break;
      case "parity": {
        const value = state.sums[condition.segment];
        if (condition.parity === "even" ? value % 2 !== 0 : Math.abs(value % 2) !== 1) return false;
        break;
      }
      case "non-decreasing": {
        const values = condition.segments.map((segment) => state.sums[segment]);
        if (!values.every((value, index) => index === 0 || values[index - 1] <= value)) return false;
        break;
      }
      case "non-increasing": {
        const values = condition.segments.map((segment) => state.sums[segment]);
        if (!values.every((value, index) => index === 0 || values[index - 1] >= value)) return false;
        break;
      }
      case "adjacent-diff":
        if (Math.abs(state.sums[condition.a] - state.sums[condition.b]) > condition.maxDiff) return false;
        break;
      case "segment-colors":
        if (state.blackCounts[condition.segment] !== condition.black || state.whiteCounts[condition.segment] !== condition.white) return false;
        break;
      case "all-distinct":
        if (state.valueSets[condition.segment].size !== state.counts[condition.segment]) return false;
        break;
      case "max-sum-each":
        if (state.sums.some((sum) => sum > condition.value)) return false;
        break;
      case "placement-order":
        break;
    }
  }

  return canStillSatisfyPlacementOrder(state, conditions, seatIds);
};

const addCard = (state: SolverState, card: SolverCard, segment: number) => {
  state.assignments.push(segment);
  state.sums[segment] += card.value;
  state.counts[segment] += 1;
  state.ownerSegmentCounts[card.owner][segment] += 1;
  if (card.color === "black") state.blackCounts[segment] += 1;
  else state.whiteCounts[segment] += 1;
  state.valueSets[segment].add(card.value);
};

const removeCard = (state: SolverState, card: SolverCard, segment: number, hadValueBefore: boolean) => {
  state.assignments.pop();
  state.sums[segment] -= card.value;
  state.counts[segment] -= 1;
  state.ownerSegmentCounts[card.owner][segment] -= 1;
  if (card.color === "black") state.blackCounts[segment] -= 1;
  else state.whiteCounts[segment] -= 1;
  if (!hadValueBefore) state.valueSets[segment].delete(card.value);
};

export const canSolveDeal = (challenge: Challenge, cards: SolverCard[], seatIds: SeatId[]): SolveResult => {
  const conditions = challenge.conditions;
  const fast = tryFastSolve(challenge, cards, seatIds);
  if (fast) return fast;

  const segmentOrder = getTargetSegments(conditions);
  const sortedCards = [...cards].sort((a, b) => b.value - a.value);
  const state = createState(seatIds);

  const search = (index: number): boolean => {
    if (index === sortedCards.length) {
      return passesFinalConditions(state, conditions, seatIds);
    }

    const card = sortedCards[index];
    for (const segment of segmentOrder) {
      const hadValueBefore = state.valueSets[segment].has(card.value);
      addCard(state, card, segment);
      const violates = conditions.some((condition) => violatesUpperBounds(state, condition));
      const impossible = !conditions.every((condition) => hasRequiredFutureCards(state, condition, sortedCards, index + 1));
      if (!violates && !impossible && search(index + 1)) return true;
      removeCard(state, card, segment, hadValueBefore);
    }

    return false;
  };

  return search(0) ? { solvable: true, assignments: [...state.assignments] } : { solvable: false };
};
