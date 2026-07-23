import { z } from "zod";
import { seatIdSchema } from "../agent/memory/types.js";

// eval case 的 manifest 骨架；M9.6 扩展 promptVersion / modelSnapshot 等字段。
export const evalFixtureSchema = z.object({
  suiteVersion: z.string().min(1),
  levelId: z.string().min(1),
  playerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  seatPolicies: z.record(seatIdSchema, z.string().min(1)),
  dealSeed: z.string().min(1),
  samplingSeed: z.string().min(1)
});

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
