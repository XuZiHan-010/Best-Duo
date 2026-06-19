import { create } from "zustand";
import {
  ClientEvents,
  shouldAcceptRoomState,
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

const requestRoomSync = () => {
  if (!socket.connected) return;
  if (!useRoomStore.getState().myNick) return;
  socket.emit(ClientEvents.RoomSync);
};

socket.on(ServerEvents.RoomState, (s: PublicRoomState) => {
  const store = useRoomStore.getState();
  if (!shouldAcceptRoomState(store.roomState, s)) return;

  if (store.roomState?.phase !== s.phase) {
    store.setTimer(null);
  }

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
    useRoomStore.getState().setRoomState(null);
    useRoomStore.getState().clearMyNick();
  }
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestRoomSync();
  });
}
