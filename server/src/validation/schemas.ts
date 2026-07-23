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

const accountNicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[一-龥a-zA-Z0-9_\-\s]+$/, "昵称只允许中文、英文、数字、下划线、横线和空格");

const emailSchema = z.string().trim().min(3).max(254).email();
const accountPasswordSchema = z.string().min(8).max(64);
const roomPasswordSchema = z.string().min(1).max(128);

const playerSessionCredentialsSchema = z
  .object({
    playerId: z.string().min(1).max(128),
    reconnectToken: z.string().min(1).max(256)
  })
  .strict();

// 会话分支：session 本身即凭证，不要求房间密码与个人密码（现网客户端可能附带，服务端忽略）
const sessionJoinSchema = z.object({
  nick: nickSchema,
  avatar: avatarDataUrlSchema.nullish(),
  password: z.string().max(128).optional(),
  accountPassword: z.string().max(64).optional(),
  session: playerSessionCredentialsSchema
});

// 账号分支：房间密码是前置门槛，个人密码用于隐式注册或登录（ADR-0006）
const accountJoinSchema = z.object({
  nick: nickSchema,
  avatar: avatarDataUrlSchema.nullish(),
  password: z.string().min(1).max(128),
  accountPassword: z.string().min(4).max(64)
});

export const playerJoinSchema = z.union([sessionJoinSchema, accountJoinSchema]);

export const accountRegisterSchema = z
  .object({
    email: emailSchema,
    password: accountPasswordSchema,
    passwordConfirmation: accountPasswordSchema,
    nickname: accountNicknameSchema,
    roomPassword: roomPasswordSchema,
    avatar: avatarDataUrlSchema.nullish()
  })
  .strict()
  .refine((input) => input.password === input.passwordConfirmation, {
    message: "两次输入的密码不一致",
    path: ["passwordConfirmation"]
  });

export const accountLoginSchema = z
  .object({
    email: emailSchema,
    password: accountPasswordSchema,
    roomPassword: roomPasswordSchema
  })
  .strict();

export const accountProfileUpdateSchema = z
  .object({
    nickname: accountNicknameSchema,
    avatar: avatarDataUrlSchema.nullable().optional()
  })
  .strict();

export const accountPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(64),
    newPassword: accountPasswordSchema,
    newPasswordConfirmation: accountPasswordSchema
  })
  .strict()
  .refine((input) => input.newPassword === input.newPasswordConfirmation, {
    message: "两次输入的新密码不一致",
    path: ["newPasswordConfirmation"]
  });

export const accountEmailChangeSchema = z
  .object({ currentPassword: z.string().min(1).max(64), newEmail: emailSchema })
  .strict();

export const accountSessionsRevokeOthersSchema = z.object({}).strict();

export const adminLoginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(128),
    nick: nickSchema.optional(),
    avatar: avatarDataUrlSchema.nullish(),
    intent: z.union([z.literal("manage"), z.literal("enterRoom")]).optional()
  })
  .strict();

export const adminEnterRoomSchema = z
  .object({
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

export const adminAccountsListSchema = z
  .object({
    query: z.string().trim().max(100).optional(),
    status: z.union([z.literal("active"), z.literal("disabled"), z.literal("deleted"), z.literal("all")]).optional()
  })
  .strict();

const adminAccountTargetShape = {
  playerId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(200)
};

export const adminAccountsForceLogoutSchema = z.object(adminAccountTargetShape).strict();

export const adminAccountsSetStatusSchema = z
  .object({
    ...adminAccountTargetShape,
    status: z.union([z.literal("active"), z.literal("disabled")])
  })
  .strict();

export const adminAccountsSoftDeleteSchema = z.object(adminAccountTargetShape).strict();

export const settingsUpdateSchema = z
  .object({
    discussionMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).optional(),
    thinkSeconds: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(25), z.literal(30)]).optional(),
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
