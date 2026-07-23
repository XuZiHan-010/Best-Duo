import "../src/env.js";
import { z } from "zod";
import { defaultSettings } from "../src/config.js";
import { MockModelClient, type ModelClient } from "../src/agent/modelClient.js";
import { turnDecisionSchema } from "../src/agent/orchestrator.js";
import { strategyPlannerOutputSchema } from "../src/agent/strategyPlanner.js";
import { loadAgentProviderConfig } from "../src/agent/providerConfig.js";
import { createModelClientFromConfig } from "../src/agent/providers.js";
import { runProviderContract, type ProviderContractCase } from "../src/agentlab/providerContract.js";

const discussionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("speak"),
    replyToMessageId: z.string().min(1),
    message: z.string().min(1).max(240),
    entities: z.array(z.unknown()).default([])
  }),
  z.object({
    action: z.literal("wait"),
    reason: z.enum(["no_substantive_input", "nothing_new", "let_others_answer"])
  }),
  z.object({
    action: z.literal("suggest_end"),
    replyToMessageId: z.string().min(1),
    message: z.string().min(1).max(240),
    entities: z.array(z.unknown()).default([])
  })
]);
const retrySchema = z.object({ lessons: z.array(z.unknown()).default([]) });

const parseAndValidate = (schema: z.ZodTypeAny, content: string) => {
  try {
    return schema.safeParse(JSON.parse(content)).success;
  } catch {
    return false;
  }
};

const validateDiscussion = (
  content: string,
  expected: { action: "wait" } | { action: "speak"; replyToMessageId: string }
) => {
  try {
    const parsed = discussionSchema.safeParse(JSON.parse(content));
    if (!parsed.success || parsed.data.action !== expected.action) return false;
    if (expected.action === "wait") return true;
    if (parsed.data.action !== "speak" || parsed.data.replyToMessageId !== expected.replyToMessageId) return false;
    return !/(游戏目标|发牌并禁言|一局严格分为|看牌后禁止|规则如下)/.test(parsed.data.message);
  } catch {
    return false;
  }
};

const positiveInt = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const turnDeadlineMs = positiveInt(
  process.env.AGENT_CONTRACT_TURN_DEADLINE_MS,
  Math.max(1_500, defaultSettings.thinkSeconds * 1_000 - 1_000)
);
// 讨论 deadline 对齐生产（discussionCoordinator DEFAULT_REQUEST_DEADLINE_MS = 30s）；
// 此前 10s 比生产严，报的 timeout 掩盖了真实的 illegal_output 截断问题。
const discussionDeadlineMs = positiveInt(process.env.AGENT_CONTRACT_DISCUSSION_DEADLINE_MS, 30_000);
// 对齐生产 runtime.retryBriefDeadlineMs（30s）：flash 真实规模输入实测 7-10s。
const retryBriefDeadlineMs = positiveInt(process.env.AGENT_CONTRACT_RETRY_BRIEF_DEADLINE_MS, 30_000);

// 契约用例必须用真实规模视图：玩具视图（conditions: []、chat: []）推理量小，
// 曾让 1200 token 上限在评测全绿、生产必然截断的缺陷漏网。
const realisticConditions = [
  { type: "segment-colors", segment: 0, black: 0, white: 1 },
  { type: "exact-cards", segment: 5, count: 3 },
  { type: "all-nonempty" },
  { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] },
  { type: "max-sum-each", value: 24 }
];

const realisticSeats = [
  { id: "A", kind: "agent", nick: "AI-1" },
  { id: "B", kind: "human", nick: "小明" },
  { id: "C", kind: "human", nick: "小红" }
];

const realisticChat = [
  { id: "m1", senderSeatId: "B", nick: "小明", text: "我觉得区 1 放小牌，区 6 放大牌，先把非递减撑起来。" },
  { id: "m2", senderSeatId: "C", nick: "小红", text: "同意，那我负责区 4 和区 5，尽量放中等数值的。" },
  { id: "m3", senderSeatId: "B", nick: "小明", text: "提示标记我建议留到最后两张牌再用，前期靠约定。" },
  { id: "m4", senderSeatId: "C", nick: "小红", text: "区 1 恰好 1 张白牌这个条件谁来负责？我手上盲牌多，不太敢接。" }
];

const realisticTopK = [
  { cardId: "card-3", segment: 0 },
  { cardId: "card-1", segment: 4 },
  { cardId: "card-2", segment: 5 }
];

const validateTopKTurn = (content: string) => {
  try {
    const parsed = turnDecisionSchema.safeParse(JSON.parse(content));
    return parsed.success && realisticTopK.some(
      (candidate) => candidate.cardId === parsed.data.cardId && candidate.segment === parsed.data.segment
    );
  } catch {
    return false;
  }
};

const cases: ProviderContractCase[] = [
  {
    id: "turn-realistic",
    task: "turn",
    deadlineMs: turnDeadlineMs,
    prompt: JSON.stringify({
      seatId: "A",
      attemptId: "provider-contract",
      phaseVersion: 2,
      turnVersion: 9,
      phase: "placing",
      level: { id: "level-01", conditions: realisticConditions },
      settings: { thinkSeconds: defaultSettings.thinkSeconds, hintMarkerCount: defaultSettings.hintMarkerCount },
      seats: realisticSeats,
      hand: [
        { id: "card-1", visibleToOwner: true, value: 7, color: "black" },
        { id: "card-2", visibleToOwner: false, color: "white" },
        { id: "card-3", visibleToOwner: true, value: 2, color: "white" }
      ],
      placements: [
        [{ id: "p1", color: "white", playOrder: 1, revealed: false }],
        [{ id: "p2", color: "black", playOrder: 2, revealed: false }],
        [],
        [
          { id: "p3", color: "black", playOrder: 3, revealed: true, value: 8 },
          { id: "p4", color: "white", playOrder: 4, revealed: false }
        ],
        [{ id: "p5", color: "white", playOrder: 5, revealed: false }],
        []
      ],
      hintMarkers: { total: defaultSettings.hintMarkerCount, used: 1 },
      turn: "A",
      pendingHint: null,
      playedCount: { A: 1, B: 2, C: 2 },
      memory: {
        lockedSeatStrategy: {
          rules: [
            {
              id: "rule-1",
              type: "segment_assignment",
              strength: "strong_preference",
              targetSeatIds: ["A"],
              targetSegments: [0, 1],
              parameters: {},
              sourceMessageIds: ["m1"]
            }
          ]
        }
      },
      candidateSelection: { evaluatorVersion: "m9.3-v2", topK: realisticTopK }
    }),
    validate: validateTopKTurn
  },
  {
    id: "discussion-realistic",
    task: "discussion",
    deadlineMs: discussionDeadlineMs,
    prompt: JSON.stringify({
      kind: "discussion",
      focusMessage: realisticChat[realisticChat.length - 1],
      entitySourceContract: {
        existingMessageIds: realisticChat.map((message) => message.id),
        currentMessageSourceId: "__current_discussion_message__"
      },
      view: {
        seatId: "A",
        attemptId: "provider-contract",
        levelRunId: "provider-contract-run",
        phase: "discussion",
        level: { id: "level-01", conditions: realisticConditions },
        settings: {
          discussionMinutes: defaultSettings.discussionMinutes,
          thinkSeconds: defaultSettings.thinkSeconds,
          hintMarkerCount: defaultSettings.hintMarkerCount
        },
        seats: realisticSeats,
        chat: realisticChat,
        timer: { remainingMs: 120_000 },
        publicFacts: []
      }
    }),
    validate: (content) => validateDiscussion(content, { action: "speak", replyToMessageId: "m4" })
  },
  {
    id: "discussion-generic-waits",
    task: "discussion",
    deadlineMs: discussionDeadlineMs,
    prompt: JSON.stringify({
      kind: "discussion",
      focusMessage: { id: "m5", senderSeatId: "B", nick: "小明", text: "我们开始讨论吧" },
      entitySourceContract: {
        existingMessageIds: [...realisticChat.map((message) => message.id), "m5"],
        currentMessageSourceId: "__current_discussion_message__"
      },
      view: {
        seatId: "A",
        attemptId: "provider-contract",
        levelRunId: "provider-contract-run",
        phase: "discussion",
        level: { id: "level-01", conditions: realisticConditions },
        settings: {
          discussionMinutes: defaultSettings.discussionMinutes,
          thinkSeconds: defaultSettings.thinkSeconds,
          hintMarkerCount: defaultSettings.hintMarkerCount
        },
        seats: realisticSeats,
        chat: [...realisticChat, { id: "m5", senderSeatId: "B", nick: "小明", text: "我们开始讨论吧" }],
        timer: { remainingMs: 120_000 },
        publicFacts: []
      }
    }),
    validate: (content) => validateDiscussion(content, { action: "wait" })
  },
  {
    id: "strategy-compile-realistic",
    task: "discussion",
    deadlineMs: discussionDeadlineMs,
    prompt: JSON.stringify({
      kind: "compile_seat_strategy",
      view: {
        seatId: "A",
        attemptId: "provider-contract",
        levelRunId: "provider-contract-run",
        phase: "discussion",
        level: { id: "level-01", conditions: realisticConditions },
        settings: {
          discussionMinutes: defaultSettings.discussionMinutes,
          thinkSeconds: defaultSettings.thinkSeconds,
          hintMarkerCount: defaultSettings.hintMarkerCount
        },
        seats: realisticSeats,
        chat: realisticChat,
        timer: { remainingMs: 60_000 },
        publicFacts: []
      }
    }),
    validate: (content) => parseAndValidate(strategyPlannerOutputSchema, content)
  },
  {
    id: "retry-brief-realistic",
    task: "retry_brief",
    deadlineMs: retryBriefDeadlineMs,
    prompt: JSON.stringify({
      publicBrief: {
        levelId: "level-01",
        passedSegments: [1, 2, 3, 4],
        failedSegments: [0, 5],
        failureReason: "rule-unmet",
        segmentSums: [9, 3, 5, 7, 11, 13],
        segmentCounts: [3, 1, 2, 2, 2, 2]
      },
      publicObservationIds: ["obs-1", "obs-2", "obs-3", "obs-4", "obs-5", "obs-6"]
    }),
    validate: (content) => parseAndValidate(retrySchema, content)
  }
];

const mockClient = new MockModelClient(async (request) => {
  if (request.task === "turn") {
    return {
      content: JSON.stringify({
        cardId: "card-3",
        segment: 0,
        revealIntent: "no",
        appliedStrategyRuleIds: [],
        relaxedStrategyRuleIds: []
      })
    };
  }
  if (request.task === "discussion") {
    const input = JSON.parse(request.prompt) as { kind?: string; focusMessage?: { id?: string } };
    if (input.kind === "compile_seat_strategy") {
      return { content: JSON.stringify({ rules: [], privatePlan: ["按公开约定执行"] }) };
    }
    if (input.focusMessage?.id === "m5") {
      return { content: JSON.stringify({ action: "wait", reason: "no_substantive_input" }) };
    }
    return {
      content: JSON.stringify({
        action: "speak",
        replyToMessageId: "m4",
        message: "区1的白牌条件我来负责，其他人先按原分工。",
        entities: []
      })
    };
  }
  return { content: JSON.stringify({ lessons: [] }) };
});

const useMock = process.argv.includes("--mock");
const repeatArgument = process.argv.find((argument) => argument.startsWith("--repeat="));
// 发布验收默认每个固定 case 运行 30 次；mock 自检保持一次以便快速反馈。
const repeats = positiveInt(repeatArgument?.split("=", 2)[1], useMock ? 1 : 30);
const repeatedCases = Array.from({ length: repeats }, (_, repeatIndex) =>
  cases.map((contractCase) => ({ ...contractCase, id: `${contractCase.id}:run-${repeatIndex + 1}` }))
).flat();
let client: ModelClient | null = useMock ? mockClient : createModelClientFromConfig(loadAgentProviderConfig());
if (!client) {
  throw new Error("没有配置可用的 Provider；请设置任务 API key，或使用 --mock 运行契约自检");
}

const report = await runProviderContract(client, repeatedCases);
process.stdout.write(`${JSON.stringify({ mode: useMock ? "mock" : "real", repeats, ...report }, null, 2)}\n`);
