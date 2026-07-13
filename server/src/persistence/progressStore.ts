import fs from "node:fs";
import path from "node:path";
import type { ProgressState, RoomSettings } from "@take-time/shared";
import { defaultSettings } from "../config.js";

const FILE_NAME = "progress.json";

const fallbackProgress = (): ProgressState => ({
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
});

const allowedDiscussionMinutes = new Set<RoomSettings["discussionMinutes"]>([5, 10, 15, 20]);
const allowedThinkSeconds = new Set<RoomSettings["thinkSeconds"]>([5, 10, 15, 20, 30]);
const allowedHintMarkerCounts = new Set<RoomSettings["hintMarkerCount"]>([2, 3, 4]);

const normalizeSettings = (value: unknown): RoomSettings => {
  const settings = value && typeof value === "object" ? (value as Partial<RoomSettings>) : {};
  return {
    discussionMinutes: allowedDiscussionMinutes.has(settings.discussionMinutes as RoomSettings["discussionMinutes"])
      ? (settings.discussionMinutes as RoomSettings["discussionMinutes"])
      : defaultSettings.discussionMinutes,
    thinkSeconds: allowedThinkSeconds.has(settings.thinkSeconds as RoomSettings["thinkSeconds"])
      ? (settings.thinkSeconds as RoomSettings["thinkSeconds"])
      : defaultSettings.thinkSeconds,
    hintMarkerCount: allowedHintMarkerCounts.has(settings.hintMarkerCount as RoomSettings["hintMarkerCount"])
      ? (settings.hintMarkerCount as RoomSettings["hintMarkerCount"])
      : defaultSettings.hintMarkerCount,
    capacity: 4
  };
};

const normalizeProgress = (value: unknown): ProgressState => {
  if (!value || typeof value !== "object") return fallbackProgress();
  const record = value as Partial<ProgressState>;
  return {
    schemaVersion: 1,
    clearedLevels: [...new Set(record.clearedLevels?.filter(Number.isInteger) ?? [])].sort((a, b) => a - b),
    settings: normalizeSettings(record.settings)
  };
};

export interface ProgressStore {
  load(): ProgressState;
  save(progress: ProgressState): Promise<void>;
  flushSync(progress: ProgressState): void;
}

export const createProgressStore = (dataDir: string): ProgressStore => {
  const filePath = path.resolve(dataDir, FILE_NAME);

  const ensureDir = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  };

  const serialize = (progress: ProgressState) => {
    const normalized = normalizeProgress(progress);
    return `${JSON.stringify(normalized, null, 2)}\n`;
  };

  const writeAtomicSync = (progress: ProgressState) => {
    ensureDir();
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, serialize(progress), "utf8");
    fs.renameSync(tmpPath, filePath);
  };

  return {
    load() {
      ensureDir();
      if (!fs.existsSync(filePath)) {
        const initial = fallbackProgress();
        writeAtomicSync(initial);
        return initial;
      }

      try {
        return normalizeProgress(JSON.parse(fs.readFileSync(filePath, "utf8")));
      } catch (error) {
        console.warn(JSON.stringify({ event: "progress:load_failed", error: String(error) }));
        return fallbackProgress();
      }
    },

    async save(progress) {
      ensureDir();
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmpPath, serialize(progress), "utf8");
      await fs.promises.rename(tmpPath, filePath);
    },

    flushSync(progress) {
      writeAtomicSync(progress);
    }
  };
};
