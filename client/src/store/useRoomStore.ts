import { create } from "zustand";
import {
  ServerEvents,
  type PublicHandCard,
  type PublicRoomState,
  type RoomErrorPayload,
  type TimerState,
} from "@take-time/shared";
import { socket, onConnectionChange, clearReconnectCredentials, type ConnectionState } from "../socket/client.js";

export interface RoomStore {
  roomState: PublicRoomState | null;
  myHand: PublicHandCard[] | null;
  timer: TimerState | null;
  lastError: RoomErrorPayload | null;
  myNick: string | null;
  connectionState: ConnectionState;

  setRoomState: (s: PublicRoomState | null) => void;
  setMyHand: (h: PublicHandCard[]) => void;
  setTimer: (t: TimerState | null) => void;
  setLastError: (e: RoomErrorPayload | null) => void;
  setMyNick: (nick: string) => void;
  clearMyNick: () => void;
  setConnectionState: (s: ConnectionState) => void;
  clearError: () => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  roomState: null,
  myHand: null,
  timer: null,
  lastError: null,
  myNick: null,
  connectionState: "connecting",

  setRoomState: (s) => set({ roomState: s }),
  setMyHand: (h) => set({ myHand: h }),
  setTimer: (t) => set({ timer: t }),
  setLastError: (e) => set({ lastError: e }),
  setMyNick: (nick) => set({ myNick: nick }),
  clearMyNick: () => set({ myNick: null }),
  setConnectionState: (s) => set({ connectionState: s }),
  clearError: () => set({ lastError: null }),
}));

socket.on(ServerEvents.RoomState, (s: PublicRoomState) => {
  const store = useRoomStore.getState();
  // phase 变化时清零倒计时，防止跨阶段显示残留 timer（Bug 3）
  if (store.roomState?.phase !== s.phase) {
    store.setTimer(null);
  }

  // 若之前已确认在座，但新状态不含当前昵称，说明被踢出或座位已释放，退回登录页
  const { myNick, roomState: prev } = store;
  const wasConfirmed = Boolean(myNick && prev?.seats.some((seat) => seat.nick === myNick));
  const stillConfirmed = Boolean(myNick && s.seats.some((seat) => seat.nick === myNick));

  store.setRoomState(s);

  if (wasConfirmed && !stillConfirmed) {
    store.clearMyNick();
    clearReconnectCredentials();
  }
});

socket.on(ServerEvents.PlayerHand, (h: PublicHandCard[]) => {
  useRoomStore.getState().setMyHand(h);
});

socket.on(ServerEvents.TimerSync, (t: TimerState) => {
  useRoomStore.getState().setTimer(t);
});

socket.on(ServerEvents.GameEnded, () => {
  const store = useRoomStore.getState();
  store.clearMyNick();
  store.setMyHand([]);
  store.setTimer(null);
  store.setRoomState(null);
  clearReconnectCredentials();
});

socket.on(ServerEvents.RoomError, (e: RoomErrorPayload) => {
  const store = useRoomStore.getState();
  store.setLastError(e);
  // 若 nick 已设但服务端尚未在 room:state 中确认我们的座位，
  // 说明这是 join 阶段的拒绝（如房间已满），需退回登录页（Bug 1）
  const { myNick, roomState } = store;
  const confirmed = myNick && roomState?.seats.some((s) => s.nick === myNick);
  if (!confirmed) {
    store.clearMyNick();
  }
});

onConnectionChange((state) => {
  useRoomStore.getState().setConnectionState(state);
  if (state === "disconnected") {
    useRoomStore.getState().setRoomState(null);
    useRoomStore.getState().clearMyNick();
  }
});
