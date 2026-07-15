import React from "react";
import {
  ServerEvents,
  type AdminEnterConfirmRequiredPayload,
  type RoomErrorPayload,
} from "@take-time/shared";
import { socket } from "../socket/client.js";
import { adapter } from "../socket/adapter.js";
import { useRoomStore } from "../store/useRoomStore.js";
import { Button } from "../components/Button.js";

const ADMIN_ERROR_CODES = new Set([
  "ADMIN_DISABLED",
  "ADMIN_UNAUTHORIZED",
  "ADMIN_RATE_LIMITED",
  "STALE_ADMIN_ACTION",
  "bad-request",
]);

// 独立管理员登录页（/admin）。登录成功后服务端要么直接把管理员安置入座
// （空房间/在座恢复），要么下发确认请求；确认接管后跳回主页面，
// 管理员此后就是普通在座房主。本页不渲染任何私有手牌信息。
export function AdminPage() {
  const connectionState = useRoomStore((s) => s.connectionState);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [nick, setNick] = React.useState("管理员");
  const [confirm, setConfirm] = React.useState<AdminEnterConfirmRequiredPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const isConnected = connectionState === "connected";

  React.useEffect(() => {
    const onConfirmRequired = (payload: AdminEnterConfirmRequiredPayload) => {
      setError(null);
      setConfirm(payload);
    };
    // 接管/入座成功：会话已由 store 持久化，回主页面进入大厅。
    const onPlayerSession = () => {
      window.location.assign("/");
    };
    const onRoomError = (payload: RoomErrorPayload) => {
      if (!ADMIN_ERROR_CODES.has(payload.code)) return;
      if (payload.code === "STALE_ADMIN_ACTION") {
        setError("房间状态已变化，请在下方确认最新状态后重试");
        return;
      }
      setConfirm(null);
      setError(payload.message);
    };

    socket.on(ServerEvents.AdminEnterConfirmRequired, onConfirmRequired);
    socket.on(ServerEvents.PlayerSession, onPlayerSession);
    socket.on(ServerEvents.RoomError, onRoomError);
    return () => {
      socket.off(ServerEvents.AdminEnterConfirmRequired, onConfirmRequired);
      socket.off(ServerEvents.PlayerSession, onPlayerSession);
      socket.off(ServerEvents.RoomError, onRoomError);
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedNick = nick.trim();
    if (!username.trim() || !password || !isConnected) return;
    setError(null);
    adapter.adminLogin({
      username: username.trim(),
      password,
      nick: trimmedNick || undefined,
    });
  }

  const confirmMessage = confirm
    ? confirm.inGame
      ? "当前房间有玩家正在游戏，是否要强制进入房间并终止当前游戏？"
      : `当前房间有 ${confirm.humanSeatCount} 名玩家，强制进入将请出所有玩家，是否继续？`
    : null;

  return (
    <div className="login admin-page">
      <div className="login__card">
        <h1 className="login__title">管理员登录</h1>
        <p className="login__subtitle">Take Time · 房间管理入口</p>

        <form className="login__form" onSubmit={handleSubmit} noValidate>
          <label className="login__label" htmlFor="admin-username">管理员账号</label>
          <input
            id="admin-username"
            className="login__input"
            type="text"
            autoComplete="username"
            value={username}
            maxLength={64}
            onChange={(e) => setUsername(e.target.value)}
          />

          <label className="login__label" htmlFor="admin-password">管理员密码</label>
          <input
            id="admin-password"
            className="login__input"
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label className="login__label" htmlFor="admin-nick">入座昵称</label>
          <input
            id="admin-nick"
            className="login__input"
            type="text"
            value={nick}
            maxLength={20}
            onChange={(e) => setNick(e.target.value)}
          />

          {error && (
            <p className="login__error" role="alert">{error}</p>
          )}

          <Button
            type="submit"
            disabled={!username.trim() || !password || !isConnected}
            loading={connectionState === "connecting" || connectionState === "reconnecting"}
            className="login__submit"
          >
            {isConnected ? "登录" : "连接中…"}
          </Button>
        </form>

        {connectionState === "disconnected" && (
          <p className="login__conn-error">连接已断开，请刷新页面重试。</p>
        )}
      </div>

      {confirm && confirmMessage && (
        <div className="admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title">
          <div className="admin-confirm__card">
            <h2 id="admin-confirm-title" className="admin-confirm__title">{confirmMessage}</h2>
            <p className="admin-confirm__meta">
              当前阶段：{confirm.inGame ? "游戏进行中" : "等待大厅"} · 在座真人 {confirm.humanSeatCount} 名
            </p>
            {error && <p className="login__error" role="alert">{error}</p>}
            <div className="admin-confirm__actions">
              <Button
                variant="danger"
                onClick={() => adapter.adminSeizeRoom({ confirmedStateVersion: confirm.stateVersion })}
              >
                是
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                否
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
