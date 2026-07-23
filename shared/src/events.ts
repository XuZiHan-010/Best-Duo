import type { Phase, RoomSettings, SeatId } from "./state.js";

export const ClientEvents = {
  PlayerJoin: "player:join",
  AccountRegister: "account:register",
  AccountLogin: "account:login",
  AccountProfileUpdate: "account:profile:update",
  AccountPasswordChange: "account:password:change",
  AccountEmailChange: "account:email:change",
  AccountSessionsRevokeOthers: "account:sessions:revokeOthers",
  PlayerLeave: "player:leave",
  PlayerReady: "player:ready",
  SettingsUpdate: "settings:update",
  HostAddAgent: "host:addAgent",
  HostRemoveAgent: "host:removeAgent",
  GameStart: "game:start",
  HostSelectLevel: "host:selectLevel",
  GameBeginPlacement: "game:beginPlacement",
  ChatSend: "chat:send",
  CardPlace: "card:place",
  HintDecide: "hint:decide",
  GameRetry: "game:retry",
  GameNext: "game:next",
  GameEnd: "game:end",
  HostBackToLevelSelect: "host:backToLevelSelect",
  GameContinueToResult: "game:continueToResult",
  RoomSync: "room:sync",
  RoomReset: "room:reset",
  AdminLogin: "admin:login",
  AdminEnterRoom: "admin:enterRoom",
  AdminSeizeRoom: "admin:seizeRoom",
  AdminKickPlayer: "admin:kickPlayer",
  AdminAccountsList: "admin:accounts:list",
  AdminAccountsForceLogout: "admin:accounts:forceLogout",
  AdminAccountsSetStatus: "admin:accounts:setStatus",
  AdminAccountsSoftDelete: "admin:accounts:softDelete",
  AdminLogout: "admin:logout"
} as const;

export const ServerEvents = {
  RoomState: "room:state",
  PlayerHand: "player:hand",
  RoomError: "room:error",
  TimerSync: "timer:sync",
  GameResult: "game:result",
  GameEnded: "game:ended",
  PlayerSession: "player:session",
  AccountProfile: "account:profile",
  AccountSession: "account:session",
  AccountActionResult: "account:actionResult",
  PlayerKicked: "player:kicked",
  AdminEnterConfirmRequired: "admin:enterConfirmRequired",
  AdminSession: "admin:session",
  AdminActionResult: "admin:actionResult",
  AdminAccountsListResult: "admin:accounts:listResult",
  GameAdminSeized: "game:adminSeized"
} as const;

export type ClientEventName = (typeof ClientEvents)[keyof typeof ClientEvents];
export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];

export interface PlayerSessionCredentials {
  playerId: string;
  reconnectToken: string;
}

export interface PlayerSessionJoinPayload {
  nick: string;
  avatar?: string | null;
  /** 兼容字段：会话分支下服务端忽略 */
  password?: string;
  /** 兼容字段：会话分支下服务端忽略 */
  accountPassword?: string;
  session: PlayerSessionCredentials;
}

export interface PlayerAccountJoinPayload {
  nick: string;
  avatar?: string | null;
  /** 房间密码：注册与登录的前置门槛（ADR-0006） */
  password: string;
  /** 个人密码：首次即注册，4–64 字符 */
  accountPassword: string;
  session?: undefined;
}

export type PlayerJoinPayload = PlayerSessionJoinPayload | PlayerAccountJoinPayload;

export interface AccountRegisterPayload {
  email: string;
  password: string;
  passwordConfirmation: string;
  nickname: string;
  roomPassword: string;
  avatar?: string | null;
}

export interface AccountLoginPayload {
  email: string;
  password: string;
  roomPassword: string;
}

export interface AccountProfileUpdatePayload {
  nickname: string;
  /** Omit to keep the current avatar; null restores the account default. */
  avatar?: string | null;
}

export interface AccountPasswordChangePayload {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
}

export interface AccountEmailChangePayload {
  currentPassword: string;
  newEmail: string;
}

export interface AccountProfilePayload {
  playerId: string;
  nickname: string;
  avatar: string;
  email: string;
  emailVerified: false;
  credentialVersion: number;
  createdAt: number;
  nicknameChangedAt: number | null;
  passwordChangedAt: number;
}

export interface AccountSessionPayload {
  playerId: string;
  accountToken: string;
}

export interface AccountActionResultPayload {
  action: "register" | "profileUpdate" | "passwordChange" | "emailChange" | "revokeOthers";
  success: boolean;
  message: string;
}

export interface PlayerSessionPayload {
  playerId: string;
  reconnectToken: string;
  seatId: SeatId;
}

export type KickReason =
  | "ADMIN_SEIZED_ROOM"
  | "KICKED_BY_ADMIN"
  | "ACCOUNT_FORCE_LOGOUT"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_DELETED";

export interface PlayerKickedPayload {
  reason: KickReason;
}

export interface AdminLoginPayload {
  username: string;
  password: string;
  nick?: string;
  avatar?: string | null;
  /** manage 只建立后台会话；省略时保留旧版“登录并进入房间”行为。 */
  intent?: "manage" | "enterRoom";
}

export interface AdminEnterRoomPayload {
  nick?: string;
  avatar?: string | null;
}

export interface AdminSeizeRoomPayload {
  confirmedStateVersion: number;
}

export interface AdminKickPlayerPayload {
  seatId: SeatId;
  stateVersion: number;
  reason?: string;
}

export interface AdminAccountsListPayload {
  query?: string;
  status?: "active" | "disabled" | "deleted" | "all";
}

export interface AdminAccountTargetPayload {
  playerId: string;
  reason: string;
}

export interface AdminAccountSetStatusPayload extends AdminAccountTargetPayload {
  status: "active" | "disabled";
}

export interface AdminAccountListItem {
  playerId: string;
  nickname: string | null;
  avatar: string | null;
  maskedEmail: string | null;
  emailVerified: false;
  status: "active" | "disabled" | "deleted";
  online: boolean;
  inSeat: boolean;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
  deletedAt: number | null;
}

export interface AdminEnterConfirmRequiredPayload {
  phase: Phase;
  humanSeatCount: number;
  inGame: boolean;
  stateVersion: number;
}

export interface AdminSessionPayload {
  authenticated: true;
}

export interface AdminActionResultPayload {
  action: string;
  success: boolean;
  message: string;
}

export interface SettingsUpdatePayload extends Partial<RoomSettings> {}

export interface HostRemoveAgentPayload {
  seatId: SeatId;
}

export interface HostSelectLevelPayload {
  levelIndex: number;
}

export interface ChatSendPayload {
  text: string;
}

export interface CardPlacePayload {
  cardId: string;
  segment: number;
}

export interface HintDecidePayload {
  decision: "yes" | "no";
}

export interface RoomErrorPayload {
  code: string;
  message: string;
}
