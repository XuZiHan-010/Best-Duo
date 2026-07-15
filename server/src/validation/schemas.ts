import { z } from "zod";

const seatIdSchema = z.union([z.literal("A"), z.literal("B"), z.literal("C"), z.literal("D")]);

const avatarDataUrlSchema = z
  .string()
  .max(300_000)
  .regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "头像必须是有效的图片 data URL");

const nickSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[一-龥a-zA-Z0-9_\-\s]+$/, "昵称只允许中文、英文、数字、下划线、横线和空格");

export const playerJoinSchema = z.object({
  nick: nickSchema,
  avatar: avatarDataUrlSchema.nullish(),
  password: z.string().min(1).max(128),
  session: z
    .object({
      playerId: z.string().min(1).max(128),
      reconnectToken: z.string().min(1).max(256)
    })
    .strict()
    .optional()
});

export const adminLoginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(128),
    nick: nickSchema.optional(),
    avatar: avatarDataUrlSchema.nullish()
  })
  .strict();

export const adminSeizeRoomSchema = z
  .object({
    confirmedStateVersion: z.number().int().nonnegative()
  })
  .strict();

export const adminKickPlayerSchema = z
  .object({
    seatId: seatIdSchema,
    stateVersion: z.number().int().nonnegative(),
    reason: z.string().max(200).optional()
  })
  .strict();

export const settingsUpdateSchema = z
  .object({
    discussionMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).optional(),
    thinkSeconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).optional(),
    hintMarkerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional()
  })
  .strict();

export const hostRemoveAgentSchema = z.object({
  seatId: seatIdSchema
});

export const hostSelectLevelSchema = z.object({
  levelIndex: z.number().int().positive()
});

export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(500)
});

export const cardPlaceSchema = z.object({
  cardId: z.string().min(1),
  segment: z.number().int().min(0).max(5)
});

export const hintDecideSchema = z.object({
  decision: z.union([z.literal("yes"), z.literal("no")])
});
