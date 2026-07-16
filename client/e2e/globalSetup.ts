import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";
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
  // Respect an explicitly managed local server, but only own and stop the
  // child process created by this setup.
  if (await isServerReady()) return;

  const child = spawn(process.execPath, [path.join(rootDir, "server/dist/index.js")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "3100",
      DATA_DIR: path.join(rootDir, ".tmp-e2e-data"),
      HINT_WINDOW_MS: "2500",
      SEAT_HOLD_MS: "3000",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "e2e-admin-secret",
      // E2E 必须是确定性的：置空模型 key，Agent 走 scripted/启发式路径。
      // env.ts 不覆盖已存在的环境变量，空字符串即可屏蔽根目录 .env 的真实 key；
      // 真实模型联调走 server/scripts/runProviderContract.ts，不进 E2E。
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

  return async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  };
}
