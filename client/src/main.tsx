import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import { RoomView } from "./views/RoomView.js";
import { AdminPage } from "./views/AdminPage.js";
import { AccountSecurityPage } from "./views/AccountSecurityPage.js";
import { EmailAccountPrototype, type EmailPrototypePage } from "./views/EmailAccountPrototype.js";
import { connect, setAccountSessionAuth, setSessionAuth } from "./socket/client.js";
import { loadAccountSession, loadPlayerSession } from "./lib/session.js";

// 刷新/重开标签页：用 sessionStorage 里的玩家会话经 handshake auth 自动恢复座位。
// 昵称不再进 URL，也不再作为重连凭据。
// 无路由库：/admin 渲染独立管理员登录页，其余路径走正常游戏视图。
const isAdminPath = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const isAccountSecurityPath = window.location.pathname === "/account/security";
// 管理后台认证与玩家座位彻底分离：访问 /admin/* 时不提交玩家或账号凭证，
// 避免自动恢复座位产生 PlayerSession 并把页面弹回游戏。
if (!isAdminPath) {
  const playerSession = loadPlayerSession();
  const accountSession = loadAccountSession();
  if (playerSession) setSessionAuth(playerSession);
  if (accountSession) setAccountSessionAuth(accountSession);
}
const prototypeRoutes: Record<string, EmailPrototypePage> = {
  "/prototype/admin": "adminAccounts",
  "/prototype/admin/room": "adminRoom",
  "/prototype/account": "login",
  "/prototype/account/login": "login",
  "/prototype/account/register": "register",
  "/prototype/account/security": "security",
  // 兼容第一版原型链接；新版管理员侧栏已与玩家账号页分离。
  "/prototype/account-admin": "adminAccounts",
};
const prototypePage = prototypeRoutes[window.location.pathname];
const isAccountPrototypePath = prototypePage !== undefined;

// 纯前端 prototype 使用本地模拟数据，不建立 Socket 连接，避免影响真实房间。
if (!isAccountPrototypePath) connect();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {prototypePage ? <EmailAccountPrototype page={prototypePage} /> : isAdminPath ? <AdminPage /> : isAccountSecurityPath ? <AccountSecurityPage /> : <RoomView />}
  </React.StrictMode>
);
