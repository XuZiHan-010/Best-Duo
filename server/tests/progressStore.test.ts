import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/config.js";
import { createProgressStore } from "../src/persistence/progressStore.js";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "take-time-progress-"));

describe("progressStore", () => {
  it("persists normalized cleared levels and settings", async () => {
    const dir = tempDir();
    const store = createProgressStore(dir);

    await store.save({
      schemaVersion: 1,
      clearedLevels: [3, 1, 3],
      settings: { ...defaultSettings, hintMarkerCount: 4 }
    });

    expect(store.load()).toEqual({
      schemaVersion: 1,
      clearedLevels: [1, 3],
      settings: { ...defaultSettings, hintMarkerCount: 4, capacity: 2 }
    });
  });

  it("falls back to defaults when progress JSON is corrupt", () => {
    const dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "progress.json"), "{ nope", "utf8");

    const store = createProgressStore(dir);
    expect(store.load()).toEqual({
      schemaVersion: 1,
      clearedLevels: [],
      settings: defaultSettings
    });
  });

  it("drops invalid persisted settings values", () => {
    const dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "progress.json"),
      JSON.stringify({
        schemaVersion: 1,
        clearedLevels: [2],
        settings: {
          discussionMinutes: 999,
          thinkSeconds: 999,
          hintMarkerCount: 999,
          capacity: 4
        }
      }),
      "utf8"
    );

    const store = createProgressStore(dir);
    expect(store.load()).toEqual({
      schemaVersion: 1,
      clearedLevels: [2],
      settings: defaultSettings
    });
  });
});
