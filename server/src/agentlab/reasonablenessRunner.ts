import type { GameRoom, SeatId, TurnStrategyRuleView, TurnView } from "@take-time/shared";
import { defaultSettings } from "../config.js";
import { buildTurnView } from "../agent/views.js";
import { applyHintDecision, applyPlacement } from "../game/actions.js";
import { beginPlacement, enterDiscussion } from "../game/phases.js";
import { createGameRoom, occupiedSeats } from "../game/room.js";
import { loadLevels } from "../levels/loadLevels.js";
import { createSeededRng } from "./rng.js";
import { decideHintFromBelief } from "../agent/belief/valueBelief.js";
import type { EvalFixture } from "./fixtures.js";
import { recordHint, recordPlacement, type HintRecord, type PlacementRecord } from "./reasonableness.js";

const seatOrder: SeatId[] = ["A", "B", "C", "D"];

export type ReasonablenessDecide = (view: TurnView, seatId: SeatId) => { cardId: string; segment: number };
export type ReasonablenessDecideHint = (view: TurnView, cardId: string, segment: number) => "yes" | "no";

export interface ReasonablenessRun {
  placements: PlacementRecord[];
  hints: HintRecord[];
}

// 把锁定策略注入本座位视图，让 policy 消费、也让 recordPlacement 读到分工。
const injectStrategy = (view: TurnView, rules: TurnStrategyRuleView[]): TurnView =>
  rules.length === 0
    ? view
    : {
        ...view,
        memory: {
          lockedSeatStrategy: { version: 1, rules, privatePlan: [] },
          ownActions: [],
          currentBeliefs: [],
          pendingCommitments: []
        }
      };

// setup 单独成函数：避免 room.phase 赋值把类型收窄，令后续 while 判断误报无重叠。
const setupPlacingRoom = (fixture: EvalFixture): GameRoom => {
  const levels = loadLevels();
  const challenge = levels.find((level) => level.id === fixture.levelId);
  if (!challenge) throw new Error(`未知关卡：${fixture.levelId}`);

  const room = createGameRoom({ schemaVersion: 1, clearedLevels: [], settings: defaultSettings }, levels);
  for (const seatId of seatOrder.slice(0, fixture.playerCount)) {
    const seat = room.seats.find((candidate) => candidate.id === seatId);
    if (!seat) throw new Error(`Missing seat ${seatId}`);
    seat.nick = `eval-${seatId}`;
    seat.connected = true;
  }
  room.phase = "levelSelect";
  enterDiscussion(room, challenge);
  beginPlacement(room, { dealRng: createSeededRng(fixture.dealSeed) });
  return room;
};

// 驱动一整局，逐手在「落子前视图」上记录落子合理性/遵守，并在每个提示窗口
// 用真实 hint 策略决策并记录其合理性。不经 Socket，只驱动动作层。
export const collectReasonablenessRun = (
  fixture: EvalFixture,
  decide: ReasonablenessDecide,
  rulesBySeat: Partial<Record<SeatId, TurnStrategyRuleView[]>> = {},
  decideHint: ReasonablenessDecideHint = decideHintFromBelief
): ReasonablenessRun => {
  const room = setupPlacingRoom(fixture);
  const placements: PlacementRecord[] = [];
  const hints: HintRecord[] = [];
  // 匹配 turnCoordinator：hint 意图在落子前（牌仍在手）算好并缓存，窗口再消费。
  const pendingIntent = new Map<SeatId, "yes" | "no">();
  let guard = 0;
  while (room.phase === "placing" && guard++ < 100) {
    if (room.pendingHint) {
      const seatId = room.pendingHint.seatId;
      const decision = pendingIntent.get(seatId) ?? "no";
      pendingIntent.delete(seatId);
      applyHintDecision(room, seatId, decision);
      continue;
    }
    const actor = room.turn === "race" ? occupiedSeats(room)[0]?.id : room.turn;
    if (!actor) break;
    const view = injectStrategy(buildTurnView(room, actor), rulesBySeat[actor] ?? []);
    const move = decide(view, actor);
    placements.push(recordPlacement(view, actor, move.cardId, move.segment));
    // 只有还有标记时落子后才会开提示窗口（见 actions.applyPlacement）；此时才决策/记录。
    if (view.hintMarkers.total - view.hintMarkers.used > 0) {
      const intent = decideHint(view, move.cardId, move.segment);
      hints.push(recordHint(view, actor, move.cardId, move.segment, intent));
      pendingIntent.set(actor, intent);
    }
    applyPlacement(room, actor, { cardId: move.cardId, segment: move.segment });
  }
  return { placements, hints };
};

// 兼容旧签名：只取落子记录。
export const collectReasonablenessRecords = (
  fixture: EvalFixture,
  decide: ReasonablenessDecide,
  rulesBySeat: Partial<Record<SeatId, TurnStrategyRuleView[]>> = {}
): PlacementRecord[] => collectReasonablenessRun(fixture, decide, rulesBySeat).placements;
