import type { PublicRoomState } from "./state.js";

export const shouldAcceptRoomState = (current: PublicRoomState | null, next: PublicRoomState) =>
  !current || next.stateVersion > current.stateVersion;
