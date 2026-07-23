import { z } from "zod";
import { strategyRuleSchema } from "../memory/types.js";

export const publicClaimSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  rule: strategyRuleSchema,
  status: z.enum(["proposed", "confirmed", "conflicted"]),
  confirmedBySeatIds: z.array(z.enum(["A", "B", "C", "D"])),
  sourceMessageIds: z.array(z.string()).min(1)
});
export type PublicClaim = z.infer<typeof publicClaimSchema>;

export const publicCoordinationContractSchema = z.object({
  attemptId: z.string(),
  revision: z.number().int().positive(),
  rules: z.array(strategyRuleSchema),
  claims: z.array(publicClaimSchema),
  compiledAt: z.number()
});
export type PublicCoordinationContract = z.infer<typeof publicCoordinationContractSchema>;
