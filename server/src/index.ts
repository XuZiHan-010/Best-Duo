import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createGameRoom } from "./game/room.js";
import { loadLevels } from "./levels/loadLevels.js";
import { createProgressStore } from "./persistence/progressStore.js";
import { registerHandlers } from "./socket/registerHandlers.js";
import { InMemoryAgentRegistry } from "./agent/registry.js";
import { AgentRuntime } from "./agent/runtime.js";
import { clearAllTimers } from "./game/timers.js";
import { isAdminConfigured } from "./auth/adminAuth.js";
import { createAccountStore } from "./auth/accountStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const progressStore = createProgressStore(config.dataDir);
const accountStore = createAccountStore(config.dataDir, config.accountEmailKey);
const levels = loadLevels();
const room = createGameRoom(progressStore.load(), levels);
const agentRegistry = new InMemoryAgentRegistry();
const agentRuntime = new AgentRuntime();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    phase: room.phase,
    seats: room.seats.filter((seat) => seat.nick).length,
    levels: levels.length
  });
});

const clientDist = path.resolve(__dirname, config.clientDistDir);
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (error) => {
    if (error) {
      res.status(200).send("Take Time server is running. Build the client to serve the app shell.");
    }
  });
});

io.on("connection", (socket) => {
  registerHandlers({ io, socket, room, levels, progressStore, agentRegistry, agentRuntime, accountStore });
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: "server:listening", port: config.port, host: config.host }));
  if (isAdminConfigured()) {
    console.log(JSON.stringify({ event: "admin:enabled" }));
  } else if ((process.env.NODE_ENV ?? config.nodeEnv) === "production") {
    console.warn(
      JSON.stringify({
        event: "admin:disabled",
        message: "未配置 ADMIN_USERNAME/ADMIN_PASSWORD（或与 ROOM_PASSWORD 相同），管理员登录已禁用"
      })
    );
  }
  if (!accountStore.isAvailable()) {
    console.warn(
      JSON.stringify({
        event: "accounts:disabled",
        message: "账号仓库不可用；请配置 32 字节 ACCOUNT_EMAIL_KEY，并确认 accounts.json 为 schema v2"
      })
    );
  }
});

const shutdown = (signal: NodeJS.Signals) => {
  console.log(JSON.stringify({ event: "server:shutdown", signal }));
  clearAllTimers(room);
  progressStore.flushSync(room.progress);
  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
