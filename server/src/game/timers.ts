import type { GameRoom } from "@take-time/shared";

type TimerHandle = ReturnType<typeof setTimeout>;

const clearTimerHandles = (room: GameRoom) => {
  for (const handle of Object.values(room.timers) as TimerHandle[]) {
    if (handle) clearTimeout(handle);
  }
  room.timers = {};
};

export const clearAllTimers = (room: GameRoom) => {
  clearTimerHandles(room);
  room.timer = null;
};

export const clearTurnTimers = (room: GameRoom) => {
  if (room.timers.turn) clearTimeout(room.timers.turn);
  if (room.timers.hint) clearTimeout(room.timers.hint);
  room.timers.turn = undefined;
  room.timers.hint = undefined;
  room.timer = null;
};

export const clearHostStartTimer = (room: GameRoom) => {
  if (room.timers.hostStart) clearTimeout(room.timers.hostStart);
  room.timers.hostStart = undefined;
};

export const startHostStartTimer = (room: GameRoom, delayMs: number, onExpire: () => void) => {
  clearHostStartTimer(room);
  const hostAtStart = room.host;
  room.timers.hostStart = setTimeout(() => {
    if (room.phase === "waiting" && room.host === hostAtStart) onExpire();
  }, delayMs);
};

export const clearLevelSelectTimer = (room: GameRoom) => {
  if (room.timers.levelSelect) clearTimeout(room.timers.levelSelect);
  room.timers.levelSelect = undefined;
};

export const startLevelSelectTimer = (room: GameRoom, delayMs: number, onExpire: () => void) => {
  clearLevelSelectTimer(room);
  const version = room.phaseVersion;
  const deadline = room.timer?.kind === "levelSelect" ? room.timer.deadline : Date.now() + delayMs;
  room.timer = { kind: "levelSelect", deadline };
  room.timers.levelSelect = setTimeout(() => {
    if (room.phase === "levelSelect" && room.phaseVersion === version) onExpire();
  }, Math.max(0, deadline - Date.now()));
};

export const startDiscussionTimer = (room: GameRoom, onExpire: () => void) => {
  const existingDeadline = room.timer?.kind === "discussion" ? room.timer.deadline : null;
  clearTimerHandles(room);
  const version = room.phaseVersion;
  const deadline = existingDeadline ?? Date.now() + room.settings.discussionMinutes * 60_000;
  room.timer = { kind: "discussion", deadline };
  room.timers.discussion = setTimeout(() => {
    if (room.phase === "discussion" && room.phaseVersion === version) onExpire();
  }, Math.max(0, deadline - Date.now()));
};

export const startTurnTimer = (room: GameRoom, onExpire: () => void) => {
  if (room.timers.turn) clearTimeout(room.timers.turn);
  const version = room.turnVersion;
  const deadline = room.timer?.kind === "turn" ? room.timer.deadline : Date.now() + room.settings.thinkSeconds * 1_000;
  room.timer = { kind: "turn", deadline };
  room.timers.turn = setTimeout(() => {
    if (room.phase === "placing" && !room.pendingHint && room.turnVersion === version) onExpire();
  }, Math.max(0, deadline - Date.now()));
};

export const startHintTimer = (room: GameRoom, onExpire: () => void) => {
  if (room.timers.hint) clearTimeout(room.timers.hint);
  const version = room.turnVersion;
  const deadline = room.pendingHint?.deadline ?? Date.now() + 5_000;
  room.timer = { kind: "hint", deadline };
  room.timers.hint = setTimeout(() => {
    if (room.phase === "placing" && room.pendingHint && room.turnVersion === version) onExpire();
  }, Math.max(0, deadline - Date.now()));
};
