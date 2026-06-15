import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { createGameRoom } from "../src/game/room.js";
import { clearAllTimers, startTurnTimer } from "../src/game/timers.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

describe("timers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores stale turn timers after the turn version changes", () => {
    vi.useFakeTimers();
    const room = createGameRoom(progress, 4);
    room.phase = "placing";
    room.turn = "race";
    room.turnVersion = 1;

    const stale = vi.fn();
    startTurnTimer(room, stale);
    room.turnVersion += 1;

    vi.advanceTimersByTime(defaultSettings.thinkSeconds * 1_000);
    expect(stale).not.toHaveBeenCalled();

    const current = vi.fn();
    startTurnTimer(room, current);
    vi.advanceTimersByTime(defaultSettings.thinkSeconds * 1_000);
    expect(current).toHaveBeenCalledTimes(1);

    clearAllTimers(room);
  });
});
