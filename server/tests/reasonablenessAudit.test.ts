import { describe, expect, it } from "vitest";
import type { TurnView } from "@take-time/shared";
import {
  auditBeliefPhysicalConsistency,
  auditHintReasonableness,
  auditPlacementReasonableness
} from "../src/agentlab/reasonablenessAudit.js";

const baseView = (): TurnView => ({
  seatId: "A",
  attemptId: "attempt-audit",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: {
    id: "audit",
    name: "audit",
    levelIndex: 1,
    difficulty: "x",
    centerCap: null,
    playable: true,
    conditions: [{ type: "sum-range", segment: 0, min: 8, max: 12 }]
  },
  settings: { thinkSeconds: 10, hintMarkerCount: 3 },
  seats: [
    { id: "A", kind: "agent", nick: "A" },
    { id: "B", kind: "human", nick: "B" }
  ],
  hand: [{ id: "a-11", owner: "A", visibleToOwner: true, value: 11, color: "white" }],
  placements: [
    [{ id: "b-hidden", owner: "B", revealed: false, color: "black", placedAt: 1, playOrder: 1 }],
    [],
    [],
    [],
    [],
    []
  ],
  hintMarkers: { total: 3, used: 0 },
  turn: "A",
  pendingHint: null,
  playedCount: { B: 1 }
});

describe("independent reasonableness audit", () => {
  it("rejects an independently provable sum overflow", () => {
    const view = baseView();
    view.placements[0] = [{
      id: "b-revealed",
      owner: "B",
      revealed: true,
      color: "black",
      value: 8,
      placedAt: 1,
      playOrder: 1
    }];
    expect(auditPlacementReasonableness(view, { cardId: "a-11", segment: 0 })).toBe(false);
  });

  it("counts a missed useful signal instead of treating every no as reasonable", () => {
    const view = baseView();
    expect(
      auditHintReasonableness(view, {
        cardId: "a-11",
        segment: 0,
        revealIntent: "no"
      })
    ).toBe(false);
    expect(
      auditHintReasonableness(view, {
        cardId: "a-11",
        segment: 0,
        revealIntent: "yes"
      })
    ).toBe(true);
  });

  it("checks physical belief domains against offline truth without exposing it to the policy", () => {
    const view = baseView();
    const matching = new Map([
      ["b-hidden", { id: "b-hidden", value: 7, color: "black" as const }]
    ]);
    const impossible = new Map([
      ["b-hidden", { id: "b-hidden", value: 13, color: "black" as const }]
    ]);
    expect(auditBeliefPhysicalConsistency(view, matching)).toEqual([true]);
    expect(auditBeliefPhysicalConsistency(view, impossible)).toEqual([false]);
  });
});
