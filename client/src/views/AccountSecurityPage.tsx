import React from "react";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/Button.js";
import { ACCEPTED_AVATAR_TYPES, fileToAvatarDataUrl } from "../lib/avatar.js";
import { loadAccountSession } from "../lib/session.js";
import { adapter } from "../socket/adapter.js";
import { useRoomStore } from "../store/useRoomStore.js";

type Panel = "profile" | "password" | "email" | "sessions";

const formatDate = (value: number | null) =>
  value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value) : "暂无";

export function AccountSecurityPage() {
  const profile = useRoomStore((state) => state.accountProfile);
  const action = useRoomStore((state) => state.lastAccountAction);
  const lastError = useRoomStore((state) => state.lastError);
  const connection = useRoomStore((state) => state.connectionState);
  const setAction = useRoomStore((state) => state.setLastAccountAction);
  const clearError = useRoomStore((state) => state.clearError);
  const [panel, setPanel] = React.useState<Panel>("profile");
  const [nickname, setNickname] = React.useState("");
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [avatarChange, setAvatarChange] = React.useState<string | null | undefined>(undefined);
  const [avatarProcessing, setAvatarProcessing] = React.useState(false);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [profileFailure, setProfileFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    document.title = "账户安全 · Best Duo";
    if (!loadAccountSession()) window.location.replace("/");
  }, []);

  React.useEffect(() => {
    if (profile) {
      setProfileFailure(null);
      return;
    }
    if (lastError?.code === "INVALID_ACCOUNT_SESSION" || lastError?.code === "ACCOUNT_SESSION_REQUIRED") {
      setProfileFailure(lastError.message);
      return;
    }
    const timeout = window.setTimeout(
      () => setProfileFailure("账户资料读取超时，请返回登录后重试。"),
      8_000
    );
    return () => window.clearTimeout(timeout);
  }, [profile, lastError]);

  React.useEffect(() => {
    if (profile) {
      setNickname(profile.nickname);
      setNewEmail(profile.email);
      setAvatarPreview(profile.avatar);
      setAvatarChange(undefined);
    }
  }, [profile]);

  React.useEffect(() => {
    if (!action && !lastError) return;
    setPending(false);
    if (action?.success) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    }
  }, [action, lastError]);

  const begin = () => {
    setPending(true);
    setLocalError(null);
    setAction(null);
    clearError();
  };

  const submitProfile = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = nickname.trim();
    if (!normalized || normalized.length > 16) return setLocalError("昵称需要 1–16 个字符");
    begin();
    adapter.accountProfileUpdate({
      nickname: normalized,
      ...(avatarChange !== undefined ? { avatar: avatarChange } : {})
    });
  };

  const chooseAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarProcessing(true);
    setLocalError(null);
    clearError();
    setAction(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarPreview(dataUrl);
      setAvatarChange(dataUrl);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "头像处理失败，请换一张图片");
    } finally {
      setAvatarProcessing(false);
    }
  };

  const restoreDefaultAvatar = () => {
    setAvatarPreview(null);
    setAvatarChange(null);
    setLocalError(null);
    clearError();
    setAction(null);
  };

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8 || newPassword.length > 64) return setLocalError("新密码需要 8–64 个字符");
    if (newPassword !== confirmation) return setLocalError("两次输入的新密码不一致");
    begin();
    adapter.accountPasswordChange({ currentPassword, newPassword, newPasswordConfirmation: confirmation });
  };

  const submitEmail = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) return setLocalError("请输入有效邮箱地址");
    begin();
    adapter.accountEmailChange({ currentPassword, newEmail: newEmail.trim() });
  };

  const revokeSessions = () => {
    if (!window.confirm("确定让其他设备上的会话全部失效吗？当前设备会保留登录。")) return;
    begin();
    adapter.accountSessionsRevokeOthers();
  };

  const switchPanel = (next: Panel) => {
    setPanel(next);
    setLocalError(null);
    clearError();
    setAction(null);
    // 密码只保留在当前表单交互内，切换面板立即清空。
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  };

  const notice = localError ?? lastError?.message ?? (action?.success ? action.message : null);

  return (
    <div className="account-shell">
      <header className="account-shell__top">
        <a className="account-shell__brand" href="/">◷ BEST DUO</a>
        <a className="account-shell__back" href="/">返回游戏房间 →</a>
      </header>
      <main className="account-page">
        <aside className="account-nav" aria-label="账户设置">
          <p>ACCOUNT</p>
          <h1>账户与安全</h1>
          {([[
            "profile", "公开资料"
          ], ["password", "个人密码"], ["email", "登录邮箱"], ["sessions", "登录设备"]] as [Panel, string][]).map(([id, label], index) => (
            <button key={id} className={panel === id ? "is-active" : ""} onClick={() => switchPanel(id)}>
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </button>
          ))}
        </aside>

        <section className="account-workbench">
          <div className="account-workbench__eyebrow">PLAYER CREDENTIALS</div>
          {connection !== "connected" && <div className="account-notice">正在恢复安全连接…</div>}
          {!profile && profileFailure ? (
            <div className="account-panel account-load-error" role="alert">
              <span aria-hidden="true">!</span>
              <h2>无法读取账户资料</h2>
              <p>{profileFailure}</p>
              <Button onClick={() => window.location.assign("/")}>返回登录</Button>
            </div>
          ) : !profile ? (
            <div className="account-loading"><span />正在读取账户资料</div>
          ) : (
            <>
              {panel === "profile" && <form onSubmit={submitProfile} className="account-panel">
                <div className="account-panel__heading"><div><h2>公开资料</h2><p>头像和昵称会显示在房间座位与聊天中。</p></div><span className="account-seal" aria-hidden="true">✦</span></div>
                <div className="account-avatar-editor">
                  <Avatar
                    src={avatarPreview}
                    nick={nickname || profile.nickname}
                    size={88}
                    className="account-avatar-preview"
                  />
                  <div className="account-avatar-editor__copy">
                    <strong>玩家头像</strong>
                    <p>{avatarChange === null ? "保存后将恢复系统默认头像。" : "支持 PNG、JPG、WebP，选择后会自动裁成正方形。"}</p>
                    <div className="account-avatar-editor__actions">
                      <label className="sr-only" htmlFor="security-avatar">上传玩家头像</label>
                      <input
                        ref={avatarInputRef}
                        className="sr-only account-avatar-input"
                        id="security-avatar"
                        type="file"
                        accept={ACCEPTED_AVATAR_TYPES}
                        onChange={chooseAvatar}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        loading={avatarProcessing}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        选择图片
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={restoreDefaultAvatar}
                        disabled={avatarProcessing || avatarChange === null}
                      >
                        恢复默认
                      </Button>
                    </div>
                  </div>
                </div>
                <label htmlFor="security-nickname">游戏昵称</label>
                <input id="security-nickname" value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} />
                <p className="account-hint">头像和昵称可以随时修改；频繁提交可能触发安全限流。邮箱不会向其他玩家公开。</p>
                <Button
                  type="submit"
                  loading={pending}
                  disabled={
                    connection !== "connected" ||
                    avatarProcessing ||
                    (nickname.trim() === profile.nickname && avatarChange === undefined)
                  }
                >
                  保存公开资料
                </Button>
              </form>}

              {panel === "password" && <form onSubmit={submitPassword} className="account-panel">
                <div className="account-panel__heading"><div><h2>修改个人密码</h2><p>保存后其他设备会话立即失效。</p></div><span className="account-seal">⌁</span></div>
                <label htmlFor="security-current-password">当前密码</label>
                <input id="security-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                <label htmlFor="security-new-password">新密码</label>
                <input id="security-new-password" type="password" autoComplete="new-password" placeholder="8–64 个字符" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                <label htmlFor="security-confirm-password">确认新密码</label>
                <input id="security-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                <Button type="submit" loading={pending} disabled={connection !== "connected" || !currentPassword || !newPassword}>更新密码</Button>
              </form>}

              {panel === "email" && <form onSubmit={submitEmail} className="account-panel">
                <div className="account-panel__heading"><div><h2>更换登录邮箱</h2><p>当前阶段邮箱仅作为唯一登录标识，不代表已验证。</p></div><span className="account-seal">@</span></div>
                <label htmlFor="security-email">新登录邮箱</label>
                <input id="security-email" type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
                <label htmlFor="security-email-password">当前密码</label>
                <input id="security-email-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                <p className="account-hint">更换后请使用新邮箱登录，其他设备会话将失效。</p>
                <Button type="submit" loading={pending} disabled={connection !== "connected" || !currentPassword || newEmail.trim() === profile.email}>更换邮箱</Button>
              </form>}

              {panel === "sessions" && <div className="account-panel">
                <div className="account-panel__heading"><div><h2>登录设备</h2><p>凭证版本 {profile.credentialVersion} · 密码更新于 {formatDate(profile.passwordChangedAt)}</p></div><span className="account-seal">◎</span></div>
                <div className="account-device"><span className="account-device__dot" /><div><strong>当前浏览器</strong><p>此会话会继续保留</p></div><em>当前</em></div>
                <div className="account-danger-zone"><h3>撤销其他会话</h3><p>让已复制或遗留在其他设备上的登录凭证立即失效。</p><Button variant="danger" loading={pending} onClick={revokeSessions} disabled={connection !== "connected"}>撤销其他设备</Button></div>
              </div>}
              {notice && <div className={`account-notice ${action?.success && !localError && !lastError ? "account-notice--success" : "account-notice--error"}`} role="status">{notice}</div>}
              <footer className="account-meta">账户创建于 {formatDate(profile.createdAt)} · 未验证邮箱仅作登录标识</footer>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
