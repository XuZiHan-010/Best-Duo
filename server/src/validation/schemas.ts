import { z } from "zod";

const avatarDataUrlSchema = z
  .string()
  .max(300_000)
  .regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "头像必须是有效的图片 data URL");

export const playerJoinSchema = z.object({
  nick: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[一-龥a-zA-Z0-9_\-\s]+$/, "昵称只允许中文、英文、数字、下划线、横线和空格"),
  avatar: avatarDataUrlSchema.nullish(),
  password: z.string().min(1).max(128)
});

export const settingsUpdateSchema = z
  .object({
    discussionMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).optional(),
    thinkSeconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).optional(),
    hintMarkerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    capacity: z.literal(2).optional()
  })
  .strict();

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
