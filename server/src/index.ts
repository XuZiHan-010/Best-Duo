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
import { clearAllTimers } from "./game/timers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const progressStore = createProgressStore(config.dataDir);
const levels = loadLevels();
const room = createGameRoom(progressStore.load(), levels);

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
  registerHandlers({ io, socket, room, levels, progressStore });
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: "server:listening", port: config.port, host: config.host }));
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
