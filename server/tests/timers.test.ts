import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { failByTimeout } from "../src/game/reveal.js";
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

  it("gives a new turn its full think time instead of reusing the previous deadline", () => {
    vi.useFakeTimers();
    const room = createGameRoom(progress, 4);
    room.phase = "placing";
    room.turn = "C";
    room.turnVersion = 1;
    room.settings.thinkSeconds = 30;

    const agentTurnExpired = vi.fn();
    startTurnTimer(room, agentTurnExpired);
    const agentDeadline = room.timer?.deadline;

    vi.advanceTimersByTime(10_000);
    room.turn = "A";
    room.turnVersion += 1;

    const humanTurnExpired = vi.fn();
    startTurnTimer(room, humanTurnExpired);

    expect(room.timer?.deadline).toBe(Date.now() + 30_000);
    expect(room.timer?.deadline).toBe((agentDeadline ?? 0) + 10_000);

    vi.advanceTimersByTime(20_000);
    expect(agentTurnExpired).not.toHaveBeenCalled();
    expect(humanTurnExpired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(humanTurnExpired).toHaveBeenCalledTimes(1);

    clearAllTimers(room);
  });

  it("re-attaches the same turn without extending its deadline", () => {
    vi.useFakeTimers();
    const room = createGameRoom(progress, 4);
    room.phase = "placing";
    room.turn = "A";
    room.turnVersion = 1;
    room.settings.thinkSeconds = 30;

    startTurnTimer(room, vi.fn());
    const originalDeadline = room.timer?.deadline;
    vi.advanceTimersByTime(10_000);

    const reattached = vi.fn();
    startTurnTimer(room, reattached);

    expect(room.timer?.deadline).toBe(originalDeadline);
    vi.advanceTimersByTime(19_999);
    expect(reattached).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reattached).toHaveBeenCalledTimes(1);

    clearAllTimers(room);
  });

  it("fails by timeout when the active turn timer expires", () => {
    vi.useFakeTimers();
    const room = createGameRoom(progress, 4);
    room.phase = "placing";
    room.turn = "B";

    startTurnTimer(room, () => failByTimeout(room));
    vi.advanceTimersByTime(defaultSettings.thinkSeconds * 1_000);

    expect(room.phase).toBe("result");
    expect(room.failureReason).toBe("timeout");
    expect(room.revealResult).toBeNull();

    clearAllTimers(room);
  });
});
