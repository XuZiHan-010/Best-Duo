import {
  ClientEvents,
  type AdminKickPlayerPayload,
  type AdminLoginPayload,
  type AdminSeizeRoomPayload,
  type CardPlacePayload,
  type ChatSendPayload,
  type HintDecidePayload,
  type HostRemoveAgentPayload,
  type HostSelectLevelPayload,
  type PlayerJoinPayload,
  type SettingsUpdatePayload,
} from "@take-time/shared";
import { socket } from "./client.js";

export const adapter = {
  join(payload: PlayerJoinPayload) {
    socket.emit(ClientEvents.PlayerJoin, payload);
  },
  ready() {
    socket.emit(ClientEvents.PlayerReady);
  },
  updateSettings(payload: SettingsUpdatePayload) {
    socket.emit(ClientEvents.SettingsUpdate, payload);
  },
  addAgent() {
    socket.emit(ClientEvents.HostAddAgent);
  },
  removeAgent(payload: HostRemoveAgentPayload) {
    socket.emit(ClientEvents.HostRemoveAgent, payload);
  },
  startGame() {
    socket.emit(ClientEvents.GameStart);
  },
  selectLevel(payload: HostSelectLevelPayload) {
    socket.emit(ClientEvents.HostSelectLevel, payload);
  },
  beginPlacement() {
    socket.emit(ClientEvents.GameBeginPlacement);
  },
  sendChat(payload: ChatSendPayload) {
    socket.emit(ClientEvents.ChatSend, payload);
  },
  placeCard(payload: CardPlacePayload) {
    socket.emit(ClientEvents.CardPlace, payload);
  },
  hintDecide(payload: HintDecidePayload) {
    socket.emit(ClientEvents.HintDecide, payload);
  },
  continueToResult() {
    socket.emit(ClientEvents.GameContinueToResult);
  },
  retry() {
    socket.emit(ClientEvents.GameRetry);
  },
  nextLevel() {
    socket.emit(ClientEvents.GameNext);
  },
  backToLevelSelect() {
    socket.emit(ClientEvents.HostBackToLevelSelect);
  },
  endGame() {
    socket.emit(ClientEvents.GameEnd);
  },
  syncRoom() {
    socket.emit(ClientEvents.RoomSync);
  },
  adminLogin(payload: AdminLoginPayload) {
    socket.emit(ClientEvents.AdminLogin, payload);
  },
  adminSeizeRoom(payload: AdminSeizeRoomPayload) {
    socket.emit(ClientEvents.AdminSeizeRoom, payload);
  },
  adminKickPlayer(payload: AdminKickPlayerPayload) {
    socket.emit(ClientEvents.AdminKickPlayer, payload);
  },
};
