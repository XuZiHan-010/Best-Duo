import type { Card, SeatId } from "@take-time/shared";
import { buildCardPool } from "../src/game/deal.js";
import { canSolveDeal, type SolverCard } from "../src/game/solver.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const samples = Number(process.env.SAMPLES ?? 5000);
const exact = process.env.EXACT === "1";
const levelFilter = process.env.LEVEL ? Number(process.env.LEVEL) : null;
const seatIds: SeatId[] = ["A", "B"];

const shuffle = <T>(values: T[]) => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const makeDeal = (cards: Card[]): SolverCard[] =>
  cards.map((card, index) => ({
    ...card,
    id: `sample:${index}`,
    owner: index < 6 ? "A" : "B"
  }));

function* combinations<T>(values: T[], size: number): Generator<T[]> {
  const indexes = Array.from({ length: size }, (_value, index) => index);
  while (true) {
    yield indexes.map((index) => values[index]);

    let pivot = size - 1;
    while (pivot >= 0 && indexes[pivot] === values.length - size + pivot) pivot -= 1;
    if (pivot < 0) return;

    indexes[pivot] += 1;
    for (let index = pivot + 1; index < size; index += 1) {
      indexes[index] = indexes[index - 1] + 1;
    }
  }
}

for (const level of loadLevels().filter((level) => levelFilter === null || level.levelIndex === levelFilter)) {
  let solvable = 0;
  let total = 0;
  const deals = exact ? combinations(buildCardPool(), 12) : undefined;

  if (deals) {
    for (const deal of deals) {
      total += 1;
      if (canSolveDeal(level, makeDeal(deal), seatIds).solvable) solvable += 1;
    }
  } else {
    total = samples;
    for (let sample = 0; sample < samples; sample += 1) {
      const cards = makeDeal(shuffle(buildCardPool()).slice(0, 12));
      if (canSolveDeal(level, cards, seatIds).solvable) solvable += 1;
    }
  }

  const rate = solvable / total;
  console.log(
    JSON.stringify({
      levelIndex: level.levelIndex,
      id: level.id,
      name: level.name,
      mode: exact ? "exact" : "sample",
      deals: total,
      solvable,
      unsolvable: total - solvable,
      solvableRate: Number(rate.toFixed(4))
    })
  );
}
