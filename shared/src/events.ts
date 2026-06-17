import type { RoomSettings } from "./state.js";

export const ClientEvents = {
  PlayerJoin: "player:join",
  PlayerLeave: "player:leave",
  PlayerReady: "player:ready",
  SettingsUpdate: "settings:update",
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
  RoomReset: "room:reset"
} as const;

export const ServerEvents = {
  RoomState: "room:state",
  PlayerHand: "player:hand",
  RoomError: "room:error",
  TimerSync: "timer:sync",
  GameResult: "game:result",
  GameEnded: "game:ended"
} as const;

export type ClientEventName = (typeof ClientEvents)[keyof typeof ClientEvents];
export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];

export interface PlayerJoinPayload {
  nick: string;
  avatar?: string | null;
  password: string;
}

export interface SettingsUpdatePayload extends Partial<RoomSettings> {}

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
