import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // The app is a single global room (singleton server-side state) — every
  // spec must run against a clean room, so tests cannot run concurrently.
  workers: 1,
  retries: 0,
  globalSetup: path.join(__dirname, "e2e/globalSetup.ts"),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
});
