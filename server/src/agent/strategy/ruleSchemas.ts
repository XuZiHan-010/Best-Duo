import { z } from "zod";

const seatIdSchema = z.enum(["A", "B", "C", "D"]);
const strengthSchema = z.enum(["hard_commitment", "strong_preference", "suggestion", "unresolved"]);
const segmentSchema = z.number().int().min(0).max(5);

export const executableRuleTypeSchema = z.enum([
  "segment_assignment",
  "avoid_segment",
  "value_band",
  "color_allocation",
  "placement_order",
  "reserve_capacity",
  "hint_policy"
]);

const common = {
  strength: strengthSchema.default("suggestion"),
  targetSeatIds: z.array(seatIdSchema).default([]),
  targetSegments: z.array(segmentSchema).default([]),
  sourceMessageIds: z.array(z.string()).default([])
};

const publicRuleDraftUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("segment_assignment"), ...common, parameters: z.object({}).passthrough().default({}) }),
  z.object({ type: z.literal("avoid_segment"), ...common, parameters: z.object({}).passthrough().default({}) }),
  z.object({
    type: z.literal("value_band"),
    ...common,
    parameters: z.object({ min: z.number().int().min(1).max(12), max: z.number().int().min(1).max(12) })
  }),
  z.object({
    type: z.literal("color_allocation"),
    ...common,
    parameters: z.object({
      color: z.enum(["white", "black"]),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
      exact: z.number().int().nonnegative().optional()
    })
  }),
  z.object({
    type: z.literal("placement_order"),
    ...common,
    parameters: z.object({ order: z.number().int().min(1).max(12) })
  }),
  z.object({
    type: z.literal("reserve_capacity"),
    ...common,
    parameters: z.object({ maxCards: z.number().int().min(1).max(12) })
  }),
  z.object({
    type: z.literal("hint_policy"),
    ...common,
    parameters: z.object({
      mode: z.enum(["never", "always_known", "high_information"]),
      minMarkers: z.number().int().nonnegative().default(1)
    })
  })
]);

export const publicRuleDraftSchema = publicRuleDraftUnion.superRefine((rule, ctx) => {
  if (rule.type === "value_band" && rule.parameters.min > rule.parameters.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value_band min 必须 <= max", path: ["parameters"] });
  }
  if (rule.type === "color_allocation") {
    const { min, max, exact } = rule.parameters;
    if (exact === undefined && min === undefined && max === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "color_allocation 至少需要 min/max/exact", path: ["parameters"] });
    }
    if (min !== undefined && max !== undefined && min > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "color_allocation min 必须 <= max", path: ["parameters"] });
    }
  }
});

export type PublicRuleDraft = z.infer<typeof publicRuleDraftSchema>;

export const executableRuleParametersValid = (rule: {
  type: string;
  targetSeatIds: string[];
  targetSegments?: number[];
  parameters: Record<string, unknown>;
}): boolean => {
  if (!executableRuleTypeSchema.safeParse(rule.type).success) return false;
  return publicRuleDraftSchema.safeParse({
    type: rule.type,
    strength: "suggestion",
    targetSeatIds: rule.targetSeatIds,
    targetSegments: rule.targetSegments ?? [],
    parameters: rule.parameters,
    sourceMessageIds: []
  }).success;
};
