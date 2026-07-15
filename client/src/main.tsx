import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import { RoomView } from "./views/RoomView.js";
import { connect, setSessionAuth } from "./socket/client.js";
import { loadPlayerSession } from "./lib/session.js";

// 刷新/重开标签页：用 sessionStorage 里的玩家会话经 handshake auth 自动恢复座位。
// 昵称不再进 URL，也不再作为重连凭据。
const session = loadPlayerSession();
if (session) setSessionAuth(session);

connect();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RoomView />
  </React.StrictMode>
);
