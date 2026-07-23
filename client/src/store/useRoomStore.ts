import { create } from "zustand";
import {
  ClientEvents,
  shouldAcceptRoomState,
  ServerEvents,
  type AccountSessionPayload,
  type AccountActionResultPayload,
  type AccountProfilePayload,
  type KickReason,
  type PlayerKickedPayload,
  type PlayerSessionPayload,
  type PublicHandCard,
  type PublicRoomState,
  type RoomErrorPayload,
  type SeatId,
  type TimerState,
} from "@take-time/shared";
import { socket, onConnectionChange, setAccountSessionAuth, setSessionAuth, type ConnectionState } from "../socket/client.js";
import { clearAccountSession, clearPlayerSession, saveAccountSession, savePlayerSession } from "../lib/session.js";

export interface RoomStore {
  roomState: PublicRoomState | null;
  myHand: PublicHandCard[] | null;
  timer: TimerState | null;
  lastError: RoomErrorPayload | null;
  myNick: string | null;
  mySeatId: SeatId | null;
  kickNotice: KickReason | null;
  isAdmin: boolean;
  connectionState: ConnectionState;
  accountProfile: AccountProfilePayload | null;
  lastAccountAction: AccountActionResultPayload | null;

  setRoomState: (s: PublicRoomState | null) => void;
  setMyHand: (h: PublicHandCard[]) => void;
  setTimer: (t: TimerState | null) => void;
  setLastError: (e: RoomErrorPayload | null) => void;
  setMyNick: (nick: string) => void;
  clearMyNick: () => void;
  setMySeatId: (seatId: SeatId | null) => void;
  setKickNotice: (reason: KickReason | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setConnectionState: (s: ConnectionState) => void;
  setAccountProfile: (profile: AccountProfilePayload | null) => void;
  setLastAccountAction: (result: AccountActionResultPayload | null) => void;
  clearError: () => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  roomState: null,
  myHand: null,
  timer: null,
  lastError: null,
  myNick: null,
  mySeatId: null,
  kickNotice: null,
  isAdmin: false,
  connectionState: "connecting",
  accountProfile: null,
  lastAccountAction: null,

  setRoomState: (s) => set({ roomState: s }),
  setMyHand: (h) => set({ myHand: h }),
  setTimer: (t) => set({ timer: t }),
  setLastError: (e) => set({ lastError: e }),
  setMyNick: (nick) => set({ myNick: nick }),
  clearMyNick: () => set({ myNick: null }),
  setMySeatId: (seatId) => set({ mySeatId: seatId }),
  setKickNotice: (reason) => set({ kickNotice: reason }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setConnectionState: (s) => set({ connectionState: s }),
  setAccountProfile: (profile) => set({ accountProfile: profile }),
  setLastAccountAction: (result) => set({ lastAccountAction: result }),
  clearError: () => set({ lastError: null }),
}));

// 座位令牌与账号令牌分离：离座不等于退出账号。
const dropLocalSeatSession = () => {
  const store = useRoomStore.getState();
  store.clearMyNick();
  store.setMySeatId(null);
  store.setIsAdmin(false);
  clearPlayerSession();
  setSessionAuth(null);
};

const dropLocalAccountSession = () => {
  const store = useRoomStore.getState();
  store.setAccountProfile(null);
  store.setLastAccountAction(null);
  clearAccountSession();
  setAccountSessionAuth(null);
};

const requestRoomSync = () => {
  if (!socket.connected) return;
  if (!useRoomStore.getState().mySeatId && !useRoomStore.getState().myNick) return;
  socket.emit(ClientEvents.RoomSync);
};

socket.on(ServerEvents.RoomState, (s: PublicRoomState) => {
  const store = useRoomStore.getState();
  if (!shouldAcceptRoomState(store.roomState, s)) return;

  if (store.roomState?.phase !== s.phase) {
    store.setTimer(null);
  }

  const { myNick, mySeatId, roomState: prev } = store;

  // 会话自动恢复场景（刷新后直连）：本地还没有昵称，从确认座位回填。
  const mySeat = mySeatId ? s.seats.find((seat) => seat.id === mySeatId) ?? null : null;
  if (!myNick && mySeat?.nick) store.setMyNick(mySeat.nick);
  const effectiveNick = myNick ?? mySeat?.nick ?? null;

  // 会话身份以 seatId 为准；昵称是可修改资料，不能拿旧昵称判断“座位丢失”。
  const wasConfirmed = mySeatId
    ? Boolean(prev?.seats.some((seat) => seat.id === mySeatId && seat.nick))
    : Boolean(effectiveNick && prev?.seats.some((seat) => seat.nick === effectiveNick));
  const stillConfirmed = mySeatId
    ? Boolean(s.seats.some((seat) => seat.id === mySeatId && seat.nick))
    : Boolean(effectiveNick && s.seats.some((seat) => seat.nick === effectiveNick));

  store.setRoomState(s);

  if (wasConfirmed && !stillConfirmed) {
    dropLocalSeatSession();
  }
});

socket.on(ServerEvents.PlayerSession, (p: PlayerSessionPayload) => {
  savePlayerSession(p);
  setSessionAuth(p);
  useRoomStore.getState().setMySeatId(p.seatId);
});

socket.on(ServerEvents.AccountSession, (session: AccountSessionPayload) => {
  saveAccountSession(session);
  setAccountSessionAuth(session);
});

socket.on(ServerEvents.AccountProfile, (profile: AccountProfilePayload) => {
  const store = useRoomStore.getState();
  store.setAccountProfile(profile);
  if (store.mySeatId) store.setMyNick(profile.nickname);
});

socket.on(ServerEvents.AccountActionResult, (result: AccountActionResultPayload) => {
  useRoomStore.getState().setLastAccountAction(result);
});

socket.on(ServerEvents.AdminSession, () => {
  useRoomStore.getState().setIsAdmin(true);
});

socket.on(ServerEvents.PlayerKicked, (p: PlayerKickedPayload) => {
  const store = useRoomStore.getState();
  dropLocalSeatSession();
  if (["ACCOUNT_FORCE_LOGOUT", "ACCOUNT_DISABLED", "ACCOUNT_DELETED"].includes(p.reason)) {
    dropLocalAccountSession();
  }
  store.setMyHand([]);
  store.setTimer(null);
  store.setRoomState(null);
  store.setKickNotice(p.reason);
});

socket.on(ServerEvents.PlayerHand, (h: PublicHandCard[]) => {
  useRoomStore.getState().setMyHand(h);
});

socket.on(ServerEvents.TimerSync, (t: TimerState) => {
  useRoomStore.getState().setTimer(t);
});

socket.on(ServerEvents.GameEnded, () => {
  const store = useRoomStore.getState();
  dropLocalSeatSession();
  store.setMyHand([]);
  store.setTimer(null);
  store.setRoomState(null);
});

socket.on(ServerEvents.RoomError, (e: RoomErrorPayload) => {
  const store = useRoomStore.getState();
  store.setLastError(e);
  if (e.code === "INVALID_PLAYER_SESSION") {
    dropLocalSeatSession();
    return;
  }
  if (e.code === "INVALID_ACCOUNT_SESSION" || e.code === "ACCOUNT_SESSION_REQUIRED") {
    dropLocalAccountSession();
    return;
  }
  const { myNick, roomState } = store;
  const confirmed = myNick && roomState?.seats.some((s) => s.nick === myNick);
  if (!confirmed) {
    store.clearMyNick();
  }
});

onConnectionChange((state) => {
  useRoomStore.getState().setConnectionState(state);
  if (state === "connected") requestRoomSync();
  if (state === "disconnected") {
    const store = useRoomStore.getState();
    store.setRoomState(null);
    store.clearMyNick();
    store.setMySeatId(null);
    store.setIsAdmin(false);
  }
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestRoomSync();
  });
}
