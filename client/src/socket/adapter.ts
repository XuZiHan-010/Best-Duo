import {
  ClientEvents,
  type AccountLoginPayload,
  type AccountProfileUpdatePayload,
  type AccountPasswordChangePayload,
  type AccountEmailChangePayload,
  type AdminAccountsListPayload,
  type AdminAccountTargetPayload,
  type AdminAccountSetStatusPayload,
  type AdminEnterRoomPayload,
  type AccountRegisterPayload,
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
  accountRegister(payload: AccountRegisterPayload) {
    socket.emit(ClientEvents.AccountRegister, payload);
  },
  accountLogin(payload: AccountLoginPayload) {
    socket.emit(ClientEvents.AccountLogin, payload);
  },
  accountProfileUpdate(payload: AccountProfileUpdatePayload) {
    socket.emit(ClientEvents.AccountProfileUpdate, payload);
  },
  accountPasswordChange(payload: AccountPasswordChangePayload) {
    socket.emit(ClientEvents.AccountPasswordChange, payload);
  },
  accountEmailChange(payload: AccountEmailChangePayload) {
    socket.emit(ClientEvents.AccountEmailChange, payload);
  },
  accountSessionsRevokeOthers() {
    socket.emit(ClientEvents.AccountSessionsRevokeOthers, {});
  },
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
  adminEnterRoom(payload: AdminEnterRoomPayload = {}) {
    socket.emit(ClientEvents.AdminEnterRoom, payload);
  },
  adminSeizeRoom(payload: AdminSeizeRoomPayload) {
    socket.emit(ClientEvents.AdminSeizeRoom, payload);
  },
  adminKickPlayer(payload: AdminKickPlayerPayload) {
    socket.emit(ClientEvents.AdminKickPlayer, payload);
  },
  adminAccountsList(payload: AdminAccountsListPayload = {}) {
    socket.emit(ClientEvents.AdminAccountsList, payload);
  },
  adminAccountsForceLogout(payload: AdminAccountTargetPayload) {
    socket.emit(ClientEvents.AdminAccountsForceLogout, payload);
  },
  adminAccountsSetStatus(payload: AdminAccountSetStatusPayload) {
    socket.emit(ClientEvents.AdminAccountsSetStatus, payload);
  },
  adminAccountsSoftDelete(payload: AdminAccountTargetPayload) {
    socket.emit(ClientEvents.AdminAccountsSoftDelete, payload);
  },
  adminLogout() {
    socket.emit(ClientEvents.AdminLogout);
  },
};
