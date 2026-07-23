import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const serverUrl = "http://127.0.0.1:3100/healthz";

const isServerReady = async () => {
  try {
    const response = await fetch(serverUrl);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async (child: ReturnType<typeof spawn>) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`E2E server exited before becoming ready (code ${child.exitCode})`);
    }
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the E2E server");
};

export default async function globalSetup() {
  // Respect an explicitly managed local server; only stop the process created
  // by this setup.
  if (await isServerReady()) return;

  // Account state persists across runs, so clear only the isolated E2E copies.
  for (const file of ["accounts.json", "accounts.json.bak", "account-admin-audit.jsonl"]) {
    fs.rmSync(path.join(rootDir, ".tmp-e2e-data", file), { force: true });
  }

  const child = spawn(process.execPath, [path.join(rootDir, "server/dist/index.js")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "3100",
      NODE_ENV: "test",
      DATA_DIR: path.join(rootDir, ".tmp-e2e-data"),
      HINT_WINDOW_MS: "2500",
      SEAT_HOLD_MS: "3000",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "e2e-admin-secret",
      ACCOUNT_EMAIL_KEY: "1111111111111111111111111111111111111111111111111111111111111111",
      // Keep E2E deterministic; real-provider checks use the dedicated harness.
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForServer(child);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  // A teardown function returned from globalSetup made Playwright 1.47 report
  // failed runs with exit status 0 on Windows. Unref the owned child so it does
  // not hold the runner open, then synchronously signal it during process exit;
  // this preserves Playwright's own success/failure exit code.
  child.unref();
  process.once("exit", () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
}
