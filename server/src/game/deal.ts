import type { Card, GameRoom, HandCard } from "@take-time/shared";
import { dealRules } from "./dealRules.js";
import { occupiedPlayerCount, occupiedSeats } from "./room.js";
import { canSolveDeal, type SolverCard } from "./solver.js";

export type RandomSource = () => number;

const shuffle = <T>(values: T[], rng: RandomSource) => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

// 全局牌池：24 张，白色 1–12 + 黑色 1–12。每局随机抽 12 张发牌。
export const buildCardPool = (): Card[] => {
  const pool: Card[] = [];
  for (const color of ["white", "black"] as const) {
    for (let value = 1; value <= 12; value += 1) {
      pool.push({ value, color });
    }
  }
  return pool;
};

// rng 可注入：eval runner 用固定种子重放同一局；生产默认 Math.random。
export const dealHands = (room: GameRoom, rng: RandomSource = Math.random) => {
  if (!room.currentChallenge) throw new Error("No challenge selected");

  const seated = occupiedSeats(room);
  const rule = dealRules[occupiedPlayerCount(room)];
  const neededCards = seated.length * rule.handSize;
  const maxAttempts = 500;

  let deck: SolverCard[] | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = shuffle(buildCardPool(), rng)
      .slice(0, neededCards)
      .map<SolverCard>((card, index) => ({
        ...card,
        id: `candidate:${attempt}:${index}`,
        owner: seated[Math.floor(index / rule.handSize)].id
      }));

    if (canSolveDeal(room.currentChallenge, candidate, seated.map((seat) => seat.id)).solvable) {
      deck = candidate;
      if (attempt > 1) {
        console.log(JSON.stringify({ event: "deal:reshuffled_until_solvable", levelIndex: room.currentChallenge.levelIndex, attempt }));
      }
      break;
    }
  }

  if (!deck) {
    throw new Error(`Unable to deal a solvable hand after ${maxAttempts} attempts`);
  }

  room.hands = {};
  room.playedCount = {};

  seated.forEach((seat, seatIndex) => {
    const cards = deck.slice(seatIndex * rule.handSize, (seatIndex + 1) * rule.handSize);
    const visibleMask = rule.initialVisibleMask(rule.handSize);
    room.hands[seat.id] = cards.map<HandCard>((card, cardIndex) => ({
      id: `${room.currentChallenge?.id}:${seat.id}:${cardIndex}:${Date.now()}`,
      owner: seat.id,
      value: card.value,
      color: card.color,
      initiallyVisibleToOwner: visibleMask[cardIndex],
      visibleToOwner: visibleMask[cardIndex]
    }));
    room.playedCount[seat.id] = 0;
  });
};

export const revealRemainingBlindCardsIfNeeded = (room: GameRoom) => {
  const rule = dealRules[occupiedPlayerCount(room)];
  const revealRemainingAfter = rule.revealRemainingAfter;
  if (revealRemainingAfter === null) return;

  const seated = occupiedSeats(room);
  if (seated.length === 0) return;
  if (seated.some((seat) => (room.playedCount[seat.id] ?? 0) < revealRemainingAfter)) return;

  for (const seat of seated) {
    for (const card of room.hands[seat.id] ?? []) {
      card.visibleToOwner = true;
    }
  }
};
