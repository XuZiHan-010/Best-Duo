import { describe, expect, test } from "vitest";
import { shouldAcceptRoomState, type PublicRoomState } from "@take-time/shared";
import { createGameRoom } from "./game/room.js";
import { emitStateToAll } from "./socket/emit.js";

const stateWithVersion = (stateVersion: number) => ({ stateVersion }) as PublicRoomState;

describe("state version synchronization", () => {
  test("client-side guard rejects stale room states", () => {
    expect(shouldAcceptRoomState(null, stateWithVersion(1))).toBe(true);
    expect(shouldAcceptRoomState(stateWithVersion(2), stateWithVersion(3))).toBe(true);
    expect(shouldAcceptRoomState(stateWithVersion(3), stateWithVersion(3))).toBe(false);
    expect(shouldAcceptRoomState(stateWithVersion(3), stateWithVersion(2))).toBe(false);
  });

  test("room broadcasts advance the public state version", () => {
    const room = createGameRoom(
      {
        schemaVersion: 1,
        clearedLevels: [],
        settings: {
          discussionMinutes: 5,
          thinkSeconds: 5,
          hintMarkerCount: 3,
          capacity: 2
        }
      },
      []
    );

    const emitted: PublicRoomState[] = [];
    const io = {
      emit: (event: string, payload: PublicRoomState) => {
        if (event === "room:state") emitted.push(payload);
      }
    };

    emitStateToAll(io as never, room, "test");
    emitStateToAll(io as never, room, "test");

    expect(emitted.map((state) => state.stateVersion)).toEqual([1, 2]);
    expect(room.stateVersion).toBe(2);
  });
});
