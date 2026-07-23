import React from "react";
import { Button } from "../components/Button.js";
import { adapter } from "../socket/adapter.js";
import { useRoomStore } from "../store/useRoomStore.js";

type AuthMode = "login" | "register";

const modeFromPath = (): AuthMode =>
  window.location.pathname === "/account/register" ? "register" : "login";

const emailLooksValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const nicknameLooksValid = (nickname: string) =>
  /^[一-龥a-zA-Z0-9_\-\s]+$/.test(nickname) && nickname.trim().length <= 16;

function ClockMark() {
  return (
    <svg className="auth__clock" aria-hidden="true" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="2.5" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <line
          key={deg}
          x1="24"
          y1="5"
          x2="24"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.4"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <line x1="24" y1="24" x2="24" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="24" x2="32" y2="27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Login() {
  const [mode, setMode] = React.useState<AuthMode>(modeFromPath);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [roomPassword, setRoomPassword] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const connectionState = useRoomStore((state) => state.connectionState);
  const lastError = useRoomStore((state) => state.lastError);
  const lastAccountAction = useRoomStore((state) => state.lastAccountAction);
  const clearError = useRoomStore((state) => state.clearError);
  const setLastAccountAction = useRoomStore((state) => state.setLastAccountAction);

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting" || connectionState === "reconnecting";
  const accountCreatedWithoutSeat =
    lastError?.code === "ACCOUNT_CREATED_ROOM_ENTRY_FAILED" &&
    lastAccountAction?.action === "register" &&
    lastAccountAction.success;

  React.useEffect(() => {
    const onPopState = () => setMode(modeFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    document.title = mode === "login" ? "登录 · Best Duo" : "注册 · Best Duo";
  }, [mode]);

  React.useEffect(() => {
    if (lastError) setSubmitting(false);
  }, [lastError]);

  const switchMode = (nextMode: AuthMode) => {
    if (nextMode === mode) return;
    const nextPath = nextMode === "register" ? "/account/register" : "/";
    window.history.pushState({}, "", nextPath);
    setMode(nextMode);
    setLocalError(null);
    setSubmitting(false);
    clearError();
    setLastAccountAction(null);
  };

  const validate = () => {
    const normalizedEmail = email.trim();
    if (!emailLooksValid(normalizedEmail)) return "请输入有效的邮箱地址";
    if (password.length < 8 || password.length > 64) return "个人密码需要 8–64 个字符";
    if (!roomPassword) return "请输入房间密码";
    if (mode === "register") {
      if (password !== passwordConfirmation) return "两次输入的密码不一致";
      if (!nickname.trim()) return "请输入游戏昵称";
      if (!nicknameLooksValid(nickname)) {
        return "昵称限 1–16 个字符，可使用中文、英文、数字、空格、下划线和横线";
      }
    }
    return null;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isConnected || submitting) return;
    const validationError = validate();
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setLocalError(null);
    clearError();
    setLastAccountAction(null);
    setSubmitting(true);

    if (mode === "register") {
      adapter.accountRegister({
        email: email.trim(),
        password,
        passwordConfirmation,
        nickname: nickname.trim(),
        roomPassword,
      });
      return;
    }

    adapter.accountLogin({ email: email.trim(), password, roomPassword });
  };

  const displayedError = localError ?? (accountCreatedWithoutSeat ? null : lastError?.message ?? null);

  return (
    <section className="auth" aria-labelledby="auth-title">
      <div className="auth__halo" aria-hidden="true" />
      <div className="auth__card">
        <header className="auth__brand">
          <ClockMark />
          <div>
            <strong>Best Duo</strong>
          </div>
        </header>

        <nav className="auth__tabs" aria-label="账号入口">
          <a
            href="/"
            className={mode === "login" ? "is-active" : ""}
            aria-current={mode === "login" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              switchMode("login");
            }}
          >
            登录
          </a>
          <a
            href="/account/register"
            className={mode === "register" ? "is-active" : ""}
            aria-current={mode === "register" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              switchMode("register");
            }}
          >
            注册
          </a>
        </nav>

        <div className="auth__heading">
          <p>{mode === "login" ? "RETURN TO THE TABLE" : "JOIN THE OBSERVATORY"}</p>
          <h1 id="auth-title">{mode === "login" ? "欢迎回来" : "创建玩家账号"}</h1>
          <span>{mode === "login" ? "使用邮箱进入唯一游戏房间" : "注册完成后将直接进入大厅"}</span>
        </div>

        {accountCreatedWithoutSeat ? (
          <div className="auth__created" role="status">
            <span aria-hidden="true">✓</span>
            <h2>账号已经创建</h2>
            <p>{lastAccountAction.message}</p>
            <Button type="button" onClick={() => switchMode("login")}>
              返回登录
            </Button>
          </div>
        ) : (
          <form className="auth__form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="auth-email">邮箱</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              disabled={connectionState === "disconnected" || submitting}
              aria-describedby="auth-account-note"
            />

            <label htmlFor="auth-password">个人密码</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="8–64 个字符"
              value={password}
              minLength={8}
              maxLength={64}
              onChange={(event) => setPassword(event.target.value)}
              disabled={connectionState === "disconnected" || submitting}
            />

            {mode === "register" && (
              <>
                <label htmlFor="auth-password-confirmation">确认密码</label>
                <input
                  id="auth-password-confirmation"
                  name="passwordConfirmation"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入个人密码"
                  value={passwordConfirmation}
                  minLength={8}
                  maxLength={64}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  disabled={connectionState === "disconnected" || submitting}
                />

                <label htmlFor="auth-nickname">游戏昵称</label>
                <input
                  id="auth-nickname"
                  name="nickname"
                  type="text"
                  autoComplete="nickname"
                  placeholder="1–16 个字符"
                  value={nickname}
                  maxLength={16}
                  onChange={(event) => setNickname(event.target.value)}
                  disabled={connectionState === "disconnected" || submitting}
                />
              </>
            )}

            <label htmlFor="auth-room-password">房间密码</label>
            <input
              id="auth-room-password"
              name="roomPassword"
              type="password"
              autoComplete="off"
              placeholder="输入共享房间密码"
              value={roomPassword}
              maxLength={128}
              onChange={(event) => setRoomPassword(event.target.value)}
              disabled={connectionState === "disconnected" || submitting}
              aria-describedby={displayedError ? "auth-error" : "auth-account-note"}
            />

            <p id="auth-account-note" className="auth__note">
              <span aria-hidden="true">!</span>
              {mode === "login"
                ? "当前不验证邮箱，也不支持找回密码，请妥善保管个人密码。"
                : "当前不验证邮箱且无法找回密码，请确认邮箱填写正确。"}
            </p>

            {displayedError && (
              <p id="auth-error" className="auth__error" role="alert">
                {displayedError}
              </p>
            )}

            <Button
              type="submit"
              className="auth__submit"
              loading={submitting || isConnecting}
              disabled={!isConnected}
            >
              {mode === "login" ? "登录并进入房间" : "创建账号并进入大厅"}
            </Button>
          </form>
        )}

        <footer className="auth__status" data-state={connectionState}>
          <i aria-hidden="true" />
          {connectionState === "connected" && "已连接到游戏房间"}
          {connectionState === "connecting" && "正在连接游戏服务…"}
          {connectionState === "reconnecting" && "连接中断，正在恢复…"}
          {connectionState === "disconnected" && "连接已断开，请刷新页面重试"}
        </footer>
      </div>
    </section>
  );
}
