import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import { RoomView } from "./views/RoomView.js";
import { AdminPage } from "./views/AdminPage.js";
import { connect, setSessionAuth } from "./socket/client.js";
import { loadPlayerSession } from "./lib/session.js";

// 刷新/重开标签页：用 sessionStorage 里的玩家会话经 handshake auth 自动恢复座位。
// 昵称不再进 URL，也不再作为重连凭据。
const session = loadPlayerSession();
if (session) setSessionAuth(session);

connect();

// 无路由库：/admin 渲染独立管理员登录页，其余路径走正常游戏视图。
// 已在座的管理员访问 /admin 时，handshake auth 会直接恢复座位并跳回 /。
const isAdminPath = window.location.pathname === "/admin";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAdminPath ? <AdminPage /> : <RoomView />}
  </React.StrictMode>
);
