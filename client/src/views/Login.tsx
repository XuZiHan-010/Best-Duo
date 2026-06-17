import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { adapter } from "../socket/adapter.js";
import { setReconnectCredentials } from "../socket/client.js";
import { Button } from "../components/Button.js";
import { Avatar } from "../components/Avatar.js";
import {
  ACCEPTED_AVATAR_TYPES,
  fileToAvatarDataUrl,
  loadStoredAvatar,
  storeAvatar,
} from "../lib/avatar.js";

export function Login() {
  const [nick, setNick] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [avatar, setAvatar] = React.useState<string | null>(() => loadStoredAvatar());
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const connectionState = useRoomStore((s) => s.connectionState);
  const lastError       = useRoomStore((s) => s.lastError);
  const setMyNick       = useRoomStore((s) => s.setMyNick);
  const clearError      = useRoomStore((s) => s.clearError);

  const isConnected = connectionState === "connected";
  const isLoading   = connectionState === "connecting" || connectionState === "reconnecting";

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setAvatarError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatar(dataUrl);
      storeAvatar(dataUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "头像处理失败");
    }
  }

  function handleClearAvatar() {
    setAvatar(null);
    storeAvatar(null);
    setAvatarError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nick.trim();
    if (!trimmed || !password || !isConnected) return;
    clearError();
    setMyNick(trimmed);
    const url = new URL(window.location.href);
    url.searchParams.set("nick", trimmed);
    window.history.replaceState(null, "", url.toString());
    window.sessionStorage.setItem("takeTime.roomPassword", password);
    setReconnectCredentials(trimmed, password);
    adapter.join({ nick: trimmed, avatar, password });
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <svg
            className="login__clock-icon"
            aria-hidden="true"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="24" cy="24" r="2.5" fill="currentColor" />
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <line
                key={deg}
                x1="24" y1="6" x2="24" y2="10"
                stroke="currentColor" strokeWidth="1.5"
                transform={`rotate(${deg} 24 24)`}
              />
            ))}
            <line x1="24" y1="24" x2="24" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="24" x2="33" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <h1 className="login__title">Best Duo</h1>
        </div>
        <p className="login__subtitle">午夜天文台 · 双人合作时钟谜题</p>

        <form className="login__form" onSubmit={handleSubmit} noValidate>
          <div className="login__avatar-field">
            <span className="login__label" id="avatar-label">头像（可选）</span>
            <div className="login__avatar-row">
              <Avatar src={avatar} nick={nick || null} size={120} />
              <div className="login__avatar-actions">
                <input
                  ref={fileInputRef}
                  id="avatar-input"
                  className="login__avatar-input"
                  type="file"
                  accept={ACCEPTED_AVATAR_TYPES}
                  onChange={handleAvatarChange}
                  aria-labelledby="avatar-label"
                  aria-describedby={avatarError ? "avatar-error" : undefined}
                />
                <label htmlFor="avatar-input" className="btn btn--ghost login__avatar-btn">
                  {avatar ? "更换头像" : "上传头像"}
                </label>
                {avatar && (
                  <button type="button" className="login__avatar-clear" onClick={handleClearAvatar}>
                    使用默认
                  </button>
                )}
              </div>
            </div>
            {avatarError && (
              <p id="avatar-error" className="login__error" role="alert">
                {avatarError}
              </p>
            )}
          </div>

          <label className="login__label" htmlFor="nick-input">昵称</label>
          <input
            id="nick-input"
            className="login__input"
            type="text"
            name="nick"
            autoComplete="nickname"
            placeholder="在此输入…"
            value={nick}
            maxLength={20}
            onChange={(e) => setNick(e.target.value)}
            disabled={connectionState === "disconnected"}
            aria-describedby={lastError ? "login-error" : undefined}
          />

          <label className="login__label" htmlFor="password-input">房间密码</label>
          <input
            id="password-input"
            className="login__input"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="输入房间密码"
            value={password}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
            disabled={connectionState === "disconnected"}
            aria-describedby={lastError ? "login-error" : undefined}
          />

          {lastError && (
            <p id="login-error" className="login__error" role="alert">
              {lastError.message}
            </p>
          )}

          <Button
            type="submit"
            disabled={!nick.trim() || !password || !isConnected}
            loading={isLoading}
            className="login__submit"
          >
            {isLoading ? "连接中…" : "进入房间"}
          </Button>
        </form>

        {connectionState === "disconnected" && (
          <p className="login__conn-error">连接已断开，请刷新页面重试。</p>
        )}
      </div>
    </div>
  );
}
