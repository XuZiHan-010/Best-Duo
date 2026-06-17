import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // The app is a single global room (singleton server-side state) — every
  // spec must run against a clean room, so tests cannot run concurrently.
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Builds the whole workspace then starts the single Express/Socket.IO
    // service that hosts the built client — mirrors the real deployment.
    command: "npm run build && npm start",
    cwd: rootDir,
    url: `http://127.0.0.1:${port}/healthz`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(port),
      DATA_DIR: path.join(rootDir, ".tmp-e2e-data"),
      // Shortened so the hint-timeout / reconnect specs don't have to wait
      // out the production-sized windows (5s / 60s).
      HINT_WINDOW_MS: "2500",
      SEAT_HOLD_MS: "3000",
    },
  },
});
