import React from "react";
import { Button } from "../components/Button.js";
import "../styles/email-account-prototype.css";

export type EmailPrototypePage = "adminAccounts" | "adminRoom" | "login" | "register" | "security";

type IconName = "alert" | "ban" | "check" | "chevron" | "clock" | "close" | "copy" | "door" | "home" | "key" | "logout" | "mail" | "search" | "send" | "shield" | "users";
type AccountStatus = "active" | "disabled" | "deleted";

interface Account {
  id: string;
  nick: string;
  initial: string;
  emailMasked: string;
  status: AccountStatus;
  presence: "playing" | "online" | "offline";
  seat?: string;
  passwordChanged: string;
  createdAt: string;
  accent: "brass" | "teal" | "coral" | "sage";
}

interface Seat {
  id: "A" | "B" | "C" | "D";
  nick: string | null;
  kind: "human" | "agent" | "empty";
  state: "ready" | "thinking" | "empty";
}

type Dialog =
  | { type: "forceLogout"; accountId: string }
  | { type: "toggleStatus"; accountId: string }
  | { type: "softDelete"; accountId: string }
  | { type: "kick"; seatId: Seat["id"] }
  | { type: "seize" }
  | { type: "changeEmail" }
  | null;

const initialAccounts: Account[] = [
  { id: "plr_7ZJ2Q9", nick: "岛屿钟匠", initial: "岛", emailMasked: "pe***@gmail.com", status: "active", presence: "playing", seat: "A", passwordChanged: "今天 09:42", createdAt: "2026-07-12", accent: "brass" },
  { id: "plr_M4K8TD", nick: "北纬三十度", initial: "北", emailMasked: "no***@outlook.com", status: "active", presence: "online", seat: "B", passwordChanged: "7 月 18 日", createdAt: "2026-07-14", accent: "teal" },
  { id: "plr_P2AV61", nick: "秒针", initial: "秒", emailMasked: "se***@qq.com", status: "active", presence: "offline", passwordChanged: "从未修改", createdAt: "2026-07-17", accent: "coral" },
  { id: "plr_X9C3LN", nick: "白昼观测员", initial: "白", emailMasked: "ba***@163.com", status: "disabled", presence: "offline", passwordChanged: "7 月 01 日", createdAt: "2026-06-29", accent: "sage" },
];

// 昵称唯一性演示用的占用表（设计 §3.3），按 nicknameNormalized 口径比对。
const TAKEN_NICKNAMES = new Set(["北纬三十度", "秒针", "白昼观测员"].map((nick) => nick.toLocaleLowerCase()));

const initialSeats: Seat[] = [
  { id: "A", nick: "岛屿钟匠", kind: "human", state: "ready" },
  { id: "B", nick: "北纬三十度", kind: "human", state: "thinking" },
  { id: "C", nick: "阿斯特拉", kind: "agent", state: "ready" },
  { id: "D", nick: null, kind: "empty", state: "empty" },
];

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    alert: <><path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v5M12 17.2v.1"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></>,
    check: <path d="m5 12 4.2 4.2L19 6.5"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    door: <><path d="M4 21h16M6 21V4l10-1v18M16 6h3v15"/><path d="M12.5 12h.1"/></>,
    home: <><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    send: <><path d="m3 11 18-8-7 18-3-7-8-3Z"/><path d="m11 14 4-4"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></>,
    users: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="7" r="2.4"/><path d="M2.8 19c.7-4 3-6 5.2-6s4.5 2 5.2 6M14 13c3.2-.4 5.3 1.5 6 4.5"/></>,
  };
  return <svg className="ep-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[name]}</svg>;
}

function ClockBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ep-brand ${compact ? "ep-brand--compact" : ""}`}>
      <div className="ep-brand__dial" aria-hidden="true"><i/><i/><i/><i/><i/><i/><span/></div>
      <div><strong>TAKE TIME</strong><small>IDENTITY & ACCESS</small></div>
    </div>
  );
}

function PrototypeNavigator({ page }: { page: EmailPrototypePage }) {
  const links: Array<{ page: EmailPrototypePage; href: string; label: string }> = [
    { page: "adminAccounts", href: "/prototype/admin", label: "管理员" },
    { page: "login", href: "/prototype/account/login", label: "登录首页" },
    { page: "register", href: "/prototype/account/register", label: "注册账号" },
    { page: "security", href: "/prototype/account/security", label: "账号资料" },
  ];
  return (
    <nav className="ep-prototype-nav" aria-label="原型页面切换">
      <span>PROTOTYPE / 原型页面</span>
      {links.map((link) => <a key={link.page} className={page === link.page || (page === "adminRoom" && link.page === "adminAccounts") ? "is-active" : ""} href={link.href}>{link.label}</a>)}
    </nav>
  );
}

function accountStatusLabel(status: AccountStatus) {
  return status === "active" ? "正常" : status === "disabled" ? "已停用" : "已删除";
}

function AdminAvatar({ account, large = false }: { account: Account; large?: boolean }) {
  return <span className={`ep-avatar ep-avatar--${account.accent} ${large ? "ep-avatar--large" : ""}`}>{account.initial}{account.presence !== "offline" && <i />}</span>;
}

function AdminShell({ page, children }: { page: "adminAccounts" | "adminRoom"; children: React.ReactNode }) {
  return (
    <div className="ep-admin-shell">
      <aside className="ep-admin-sidebar">
        <ClockBrand />
        <p className="ep-admin-sidebar__label">管理员控制台</p>
        <nav className="ep-admin-nav" aria-label="管理员功能">
          <a className={page === "adminAccounts" ? "is-active" : ""} href="/prototype/admin"><span><Icon name="users"/></span><div><small>IDENTITY</small><strong>注册账号</strong></div><Icon name="chevron" size={15}/></a>
          <a className={page === "adminRoom" ? "is-active" : ""} href="/prototype/admin/room"><span><Icon name="home"/></span><div><small>LIVE ROOM</small><strong>实时房间</strong></div><Icon name="chevron" size={15}/></a>
        </nav>
        <div className="ep-admin-sidebar__boundary"><Icon name="shield"/><p><strong>管理边界</strong>管理员不能查看、代设或重置玩家密码。</p></div>
        <div className="ep-admin-profile"><span>管</span><div><strong>管理员</strong><small>管理会话已验证</small></div><Icon name="logout"/></div>
      </aside>
      <main className="ep-admin-main">
        <div className="ep-admin-topline"><span>TAKE TIME / {page === "adminAccounts" ? "IDENTITY" : "LIVE ROOM"}</span><div><span><Icon name="shield" size={14}/> 管理会话已验证</span><time>2026.07.20&nbsp;&nbsp;11:42</time></div></div>
        {children}
      </main>
    </div>
  );
}

export function EmailAccountPrototype({ page }: { page: EmailPrototypePage }) {
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [selectedId, setSelectedId] = React.useState(initialAccounts[0]!.id);
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [seats, setSeats] = React.useState(initialSeats);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0]!;
  const dialogAccount = dialog && "accountId" in dialog ? accounts.find((account) => account.id === dialog.accountId) ?? null : null;

  function notify(message: string) { setToast(message); }

  function updateAccount(accountId: string, patch: Partial<Account>) {
    setAccounts((current) => current.map((account) => account.id === accountId ? { ...account, ...patch } : account));
  }

  function confirmDialog() {
    if (!dialog) return;
    if (dialog.type === "forceLogout" && dialogAccount) {
      updateAccount(dialogAccount.id, { presence: "offline", seat: undefined });
      setSeats((current) => current.map((seat) => seat.nick === dialogAccount.nick ? { ...seat, nick: null, kind: "empty", state: "empty" } : seat));
      notify(`已撤销「${dialogAccount.nick}」的全部会话`);
    }
    if (dialog.type === "toggleStatus" && dialogAccount) {
      const nextStatus = dialogAccount.status === "disabled" ? "active" : "disabled";
      updateAccount(dialogAccount.id, { status: nextStatus, presence: nextStatus === "disabled" ? "offline" : dialogAccount.presence });
      notify(nextStatus === "active" ? `已恢复「${dialogAccount.nick}」` : `已停用「${dialogAccount.nick}」`);
    }
    if (dialog.type === "softDelete" && dialogAccount) {
      updateAccount(dialogAccount.id, { status: "deleted", presence: "offline", seat: undefined });
      notify(`「${dialogAccount.nick}」已软删除；邮箱与昵称已释放，可被重新注册`);
    }
    if (dialog.type === "kick") {
      const target = seats.find((seat) => seat.id === dialog.seatId);
      setSeats((current) => current.map((seat) => seat.id === dialog.seatId ? { ...seat, nick: null, kind: "empty", state: "empty" } : seat));
      if (target?.nick) setAccounts((current) => current.map((account) => account.nick === target.nick ? { ...account, presence: "offline", seat: undefined } : account));
      notify(`${target?.nick ?? dialog.seatId} 已被请出；注册账号保持正常`);
    }
    if (dialog.type === "seize") {
      setSeats([{ id: "A", nick: "管理员", kind: "human", state: "ready" }, { id: "B", nick: null, kind: "empty", state: "empty" }, { id: "C", nick: null, kind: "empty", state: "empty" }, { id: "D", nick: null, kind: "empty", state: "empty" }]);
      notify("管理员已显式接管房间，原对局已结束");
    }
    setDialog(null);
  }

  function renderAdminAccounts() {
    const filtered = accounts.filter((account) => {
      const q = query.trim().toLocaleLowerCase();
      return !q || account.nick.toLocaleLowerCase().includes(q) || account.id.toLocaleLowerCase().includes(q) || account.emailMasked.toLocaleLowerCase().includes(q);
    });
    return (
      <AdminShell page="adminAccounts">
        <div className="ep-admin-workspace">
          <header className="ep-page-head ep-rise" style={{ "--delay": "40ms" } as React.CSSProperties}>
            <div><p className="ep-kicker">IDENTITY LEDGER / 身份账簿</p><h1>注册账号</h1><p>维护账号状态和会话。邮箱仅是未验证登录标识；管理员永远看不到或重置玩家密码。</p></div>
            <span className="ep-service-ok"><i/> 账号库正常 · 邮件能力未启用</span>
          </header>
          <section className="ep-stats ep-rise" style={{ "--delay": "90ms" } as React.CSSProperties}>
            <article className="is-primary"><span className="ep-stat-dial">{accounts.length}</span><div><small>注册账号</small><strong>{accounts.filter((a) => a.status === "active").length} 个可用</strong></div></article>
            <article><Icon name="users"/><div><small>当前在线</small><strong>{accounts.filter((a) => a.presence !== "offline").length} 个账号</strong></div></article>
            <article><Icon name="ban"/><div><small>已停用</small><strong>{accounts.filter((a) => a.status === "disabled").length} 个账号</strong></div></article>
            <article><span className="ep-provider">ID</span><div><small>邮箱用途</small><strong>仅作登录标识</strong></div></article>
          </section>
          <div className="ep-account-console ep-rise" style={{ "--delay": "140ms" } as React.CSSProperties}>
            <section className="ep-account-list">
              <div className="ep-account-toolbar">
                <label><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称、playerId 或脱敏邮箱"/><kbd>⌘ K</kbd></label>
                <div><span className="ep-email-state ep-email-state--pending">全部邮箱均未验证</span></div>
              </div>
              <div className="ep-account-columns" aria-hidden="true"><span>玩家</span><span>登录邮箱</span><span>账号</span><span>最近改密</span><span/></div>
              {filtered.map((account, index) => (
                <button key={account.id} type="button" className={`ep-account-row ${selected.id === account.id ? "is-selected" : ""}`} onClick={() => setSelectedId(account.id)} style={{ "--row-delay": `${index * 32}ms` } as React.CSSProperties}>
                  <span className="ep-account-id"><AdminAvatar account={account}/><span><strong>{account.nick}</strong><small>{account.id}</small></span></span>
                  <span><em className="ep-email-state ep-email-state--pending">未验证</em><small>{account.emailMasked}</small></span>
                  <span className={`ep-account-state ep-account-state--${account.status}`}>{accountStatusLabel(account.status)}</span>
                  <span className="ep-muted-cell">{account.passwordChanged}</span>
                  <Icon name="chevron" size={15}/>
                </button>
              ))}
            </section>
            <aside className="ep-account-detail">
              <div className="ep-detail-code"><span>ACCOUNT / {selected.id.slice(-4)}</span><i/></div>
              <div className="ep-detail-who"><AdminAvatar account={selected} large/><div><h2>{selected.nick}</h2><p>{selected.presence === "playing" ? `${selected.seat} 座 · 对局中` : selected.presence === "online" ? `${selected.seat} 座 · 在线` : "离线"}</p></div><span className={`ep-account-state ep-account-state--${selected.status}`}>{accountStatusLabel(selected.status)}</span></div>
              <dl className="ep-detail-facts"><div><dt>登录邮箱</dt><dd>{selected.emailMasked}</dd></div><div><dt>邮箱状态</dt><dd className="is-pending">未验证</dd></div><div><dt>注册日期</dt><dd>{selected.createdAt}</dd></div><div><dt>密码更新</dt><dd>{selected.passwordChanged}</dd></div></dl>
              <div className="ep-section-label"><span>邮箱边界</span></div>
              <div className="ep-action-list">
                <p className="ep-action-note">第一阶段不验证邮箱、不发送邮件，也不支持密码找回。管理员不能代换邮箱或代设密码；玩家只能在已登录并提供当前密码时自行修改。</p>
              </div>
              <div className="ep-section-label"><span>账号维护</span></div>
              <div className="ep-action-list">
                <button type="button" onClick={() => setDialog({ type: "forceLogout", accountId: selected.id })}><span><Icon name="logout"/></span><div><strong>强制登出</strong><small>撤销全部玩家会话</small></div><Icon name="chevron"/></button>
                <button type="button" onClick={() => setDialog({ type: "toggleStatus", accountId: selected.id })}><span><Icon name={selected.status === "disabled" ? "check" : "ban"}/></span><div><strong>{selected.status === "disabled" ? "恢复账号" : "停用账号"}</strong><small>{selected.status === "disabled" ? "不会恢复旧会话，邮箱与昵称此前一直保留占用" : "阻止再次登录，邮箱与昵称保留占用，不会被他人注册"}</small></div><Icon name="chevron"/></button>
                {selected.status !== "deleted" && <button type="button" className="ep-action-list__danger" onClick={() => setDialog({ type: "softDelete", accountId: selected.id })}><span><Icon name="close"/></span><div><strong>软删除账号</strong><small>释放邮箱与昵称占用，可被重新注册为新账号</small></div><Icon name="chevron"/></button>}
              </div>
              <p className="ep-admin-guard"><Icon name="shield" size={15}/> 完整邮箱已加密；管理员只能看到必要的脱敏信息。</p>
            </aside>
          </div>
        </div>
      </AdminShell>
    );
  }

  function renderAdminRoom() {
    return (
      <AdminShell page="adminRoom">
        <div className="ep-admin-workspace">
          <header className="ep-page-head ep-rise" style={{ "--delay": "40ms" } as React.CSSProperties}><div><p className="ep-kicker">LIVE ROOM / 实时控制</p><h1>房间管理</h1><p>请出只影响当前座位；停用账号请前往“注册账号”。</p></div><Button variant="danger" onClick={() => setDialog({ type: "seize" })}><Icon name="door"/> 进入并接管房间</Button></header>
          <section className="ep-room-banner ep-rise" style={{ "--delay": "90ms" } as React.CSSProperties}><div className="ep-room-dial"><span>Ⅻ</span><i/></div><div><span className="ep-service-ok"><i/> 对局进行中</span><h2>挑战 03 · 出牌阶段</h2><p>当前回合 B 座 · 剩余 <strong>00:07</strong></p></div><dl><div><dt>在座</dt><dd>{seats.filter((s) => s.nick).length} / 4</dd></div><div><dt>真人</dt><dd>{seats.filter((s) => s.kind === "human").length}</dd></div><div><dt>STATE</dt><dd>#184</dd></div></dl></section>
          <section className="ep-seat-grid ep-rise" style={{ "--delay": "140ms" } as React.CSSProperties}>{seats.map((seat) => <article key={seat.id} className={`ep-seat ep-seat--${seat.kind}`}><header><span>SEAT {seat.id}</span><em>{seat.state === "ready" ? "已准备" : seat.state === "thinking" ? "思考中" : "空座"}</em></header><div className="ep-seat__person"><span>{seat.nick ? Array.from(seat.nick)[0] : seat.id}</span><h3>{seat.nick ?? "等待玩家"}</h3><p>{seat.kind === "agent" ? "AI AGENT · 自动座位" : seat.kind === "human" ? "注册玩家 · 会话有效" : "AVAILABLE"}</p></div>{seat.kind === "human" && seat.nick ? <button type="button" onClick={() => setDialog({ type: "kick", seatId: seat.id })}>请出房间 <Icon name="logout" size={15}/></button> : seat.kind === "agent" ? <small><Icon name="shield" size={14}/> 由房主控制</small> : null}</article>)}</section>
          <aside className="ep-room-warning"><Icon name="alert"/><p><strong>操作边界</strong>“请出房间”不修改注册账号；“接管房间”会结束当前对局并让管理员进入 A 座。</p></aside>
        </div>
      </AdminShell>
    );
  }

  function renderDialog() {
    if (!dialog) return null;
    if (dialog.type === "changeEmail") return null;
    const title = dialog.type === "forceLogout" ? `强制登出「${dialogAccount?.nick}」？` : dialog.type === "toggleStatus" ? `${dialogAccount?.status === "disabled" ? "恢复" : "停用"}「${dialogAccount?.nick}」？` : dialog.type === "softDelete" ? `软删除「${dialogAccount?.nick}」？` : dialog.type === "kick" ? `请出 ${dialog.seatId} 座玩家？` : "进入并接管当前房间？";
    const body = dialog.type === "forceLogout" ? "全部玩家会话将立即失效，账号仍可使用密码重新登录。" : dialog.type === "toggleStatus" ? (dialogAccount?.status === "disabled" ? "恢复后邮箱与昵称此前一直保留占用，无需重新注册。" : "停用会阻止该账号再次登录，并立即撤销全部会话；邮箱与昵称保留占用，不会被他人注册。") : dialog.type === "softDelete" ? "此操作不可逆：将清除密码与邮箱，释放邮箱与昵称占用，仅保留账号编号用于历史记录。同一邮箱可被重新注册，但会成为全新账号。" : dialog.type === "kick" ? "只释放当前座位，不会停用或删除注册账号。" : "当前对局会结束，全部玩家被请出，管理员进入 A 座。";
    return <div className="ep-dialog-layer"><section className="ep-dialog ep-dialog--confirm"><button type="button" className="ep-dialog__close" onClick={() => setDialog(null)}><Icon name="close"/></button><span className="ep-dialog__icon ep-dialog__icon--warn"><Icon name="alert"/></span><p className="ep-kicker">CONFIRM OPERATION</p><h2>{title}</h2><p>{body}</p><div className="ep-dialog__actions"><Button variant="ghost" onClick={() => setDialog(null)}>取消</Button><Button variant="danger" onClick={confirmDialog}>确认操作</Button></div></section></div>;
  }

  if (page === "adminAccounts" || page === "adminRoom") {
    return <div className="email-prototype"><PrototypeNavigator page={page}/>{page === "adminAccounts" ? renderAdminAccounts() : renderAdminRoom()}{toast && <div className="ep-toast"><span><Icon name="check"/></span>{toast}</div>}{renderDialog()}</div>;
  }

  return <PlayerPrototype page={page} notify={notify} dialog={dialog} setDialog={setDialog} toast={toast}/>;
}

function PlayerShell({ page, eyebrow, title, copy, children }: { page: EmailPrototypePage; eyebrow: string; title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="email-prototype ep-player-shell">
      <PrototypeNavigator page={page}/>
      <header className="ep-player-header"><ClockBrand compact/><nav><a className={page === "login" || page === "register" ? "is-active" : ""} href="/prototype/account/login">玩家入口</a><a className={page === "security" ? "is-active" : ""} href="/prototype/account/security">账号与资料</a></nav></header>
      <main className="ep-player-main">
        <div className="ep-player-intro ep-rise" style={{ "--delay": "30ms" } as React.CSSProperties}><p className="ep-kicker">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div>
        {children}
      </main>
    </div>
  );
}

function AuthTabs({ active }: { active: "login" | "register" }) {
  return <nav className="ep-auth-tabs" aria-label="玩家账号入口"><a className={active === "login" ? "is-active" : ""} href="/prototype/account/login">登录</a><a className={active === "register" ? "is-active" : ""} href="/prototype/account/register">注册</a></nav>;
}

function AuthShell({ page, children }: { page: "login" | "register"; children: React.ReactNode }) {
  return <div className="email-prototype ep-auth-shell"><PrototypeNavigator page={page}/><header className="ep-player-header"><ClockBrand compact/><a className="ep-auth-account-link" href="/prototype/account/security">账号与资料</a></header><main className="ep-auth-main">{children}</main></div>;
}

function PlayerPrototype({ page, notify, dialog, setDialog, toast }: { page: "login" | "register" | "security"; notify: (message: string) => void; dialog: Dialog; setDialog: React.Dispatch<React.SetStateAction<Dialog>>; toast: string | null }) {
  const [loginComplete, setLoginComplete] = React.useState(false);
  const [registerComplete, setRegisterComplete] = React.useState(false);
  const [registrationEmail, setRegistrationEmail] = React.useState("penguin@example.com");
  const [registrationNick, setRegistrationNick] = React.useState("岛屿钟匠");
  const [nickname, setNickname] = React.useState("岛屿钟匠");
  const [nicknameError, setNicknameError] = React.useState<string | null>(null);

  // 昵称账号级唯一（设计 §3.3）：原型用固定占用表演示冲突态，
  // 提示只说“不可用”，不透露占用者是谁。
  function submitNickname(event: React.FormEvent) {
    event.preventDefault();
    const normalized = nickname.trim().toLocaleLowerCase();
    if (!normalized) {
      setNicknameError("昵称不能为空");
      return;
    }
    if (TAKEN_NICKNAMES.has(normalized)) {
      setNicknameError("该昵称不可用");
      return;
    }
    setNicknameError(null);
    notify(`游戏昵称已更新为「${nickname}」`);
  }

  function renderLogin() {
    return (
      <AuthShell page="login">
        <section className="ep-player-card ep-auth-card ep-rise" style={{ "--delay": "40ms" } as React.CSSProperties}>
          <AuthTabs active="login"/>
          {!loginComplete ? <form className="ep-player-form" onSubmit={(event) => { event.preventDefault(); setLoginComplete(true); }}><div className="ep-auth-title"><h1>登录</h1><p>进入 Take Time</p></div><label>房间密码<input type="password" required placeholder="输入房间密码"/><small className="ep-field-hint">先校验房间准入，通过后才查询账号</small></label><label>邮箱<input type="email" required defaultValue="penguin@example.com" autoComplete="email"/></label><label>个人密码<input type="password" minLength={8} required placeholder="输入个人密码" autoComplete="current-password"/></label><p className="ep-auth-warning"><Icon name="alert"/> 当前不验证邮箱，也不支持找回密码，请妥善保管个人密码。</p><Button type="submit">登录 <Icon name="chevron"/></Button></form> : <div className="ep-verification ep-verification--compact ep-verification--complete"><span className="ep-large-mail"><Icon name="check" size={28}/></span><h2>登录成功</h2><Button onClick={() => notify("原型模式：已进入游戏大厅")}>进入游戏</Button></div>}
        </section>
      </AuthShell>
    );
  }

  function renderRegister() {
    return (
      <AuthShell page="register">
        <section className="ep-player-card ep-auth-card ep-auth-card--wide ep-rise" style={{ "--delay": "40ms" } as React.CSSProperties}>
          <AuthTabs active="register"/>
          {!registerComplete && <form className="ep-player-form" onSubmit={(event) => { event.preventDefault(); setRegisterComplete(true); }}><div className="ep-auth-title"><h1>注册</h1><p>创建新的玩家账号</p></div><label>房间密码<input type="password" required placeholder="输入房间密码"/><small className="ep-field-hint">先校验房间准入，通过后才检查邮箱与昵称</small></label><label>邮箱<input type="email" required value={registrationEmail} onChange={(event) => setRegistrationEmail(event.target.value)} placeholder="you@example.com" autoComplete="email"/></label><div className="ep-field-row"><label>个人密码<input type="password" minLength={8} required placeholder="至少 8 个字符" autoComplete="new-password"/></label><label>确认密码<input type="password" minLength={8} required placeholder="再次输入" autoComplete="new-password"/></label></div><label>游戏昵称<input required maxLength={16} value={registrationNick} onChange={(event) => setRegistrationNick(event.target.value)} placeholder="1–16 个字符，需与其他玩家不同"/><small className="ep-field-hint">昵称全局唯一；进入游戏后仍可修改</small></label><p className="ep-auth-warning"><Icon name="alert"/> 邮箱只用于登录，当前不验证邮箱且无法找回密码。请确认填写正确。</p><Button type="submit">创建账号 <Icon name="chevron"/></Button></form>}
          {registerComplete && <div className="ep-verification ep-verification--compact ep-verification--complete"><span className="ep-large-mail"><Icon name="check" size={28}/></span><h2>注册成功</h2><p>账号已直接创建，无需邮箱验证。</p><div className="ep-complete-facts"><span><small>登录邮箱</small><strong>{registrationEmail}</strong></span><span><small>昵称</small><strong>{registrationNick}</strong></span></div><Button onClick={() => notify("原型模式：已进入游戏大厅")}>进入游戏</Button></div>}
        </section>
      </AuthShell>
    );
  }

  function renderSecurity() {
    return (
      <PlayerShell page="security" eyebrow="PROFILE & SECURITY / 玩家本人" title="账号与游戏资料" copy="邮箱负责登录，昵称负责展示；两者可以分别、安全地修改。">
        <div className="ep-security-grid ep-rise" style={{ "--delay": "90ms" } as React.CSSProperties}>
          <section className="ep-player-card ep-profile-card"><form className="ep-player-form" onSubmit={submitNickname}><div className="ep-card-title"><span className="ep-profile-monogram">{Array.from(nickname)[0] ?? "时"}</span><div><h2>游戏资料</h2><p>昵称对其他玩家公开，但不承担登录功能。</p></div><em>PLAYER ID · 7ZJ2</em></div><div className="ep-profile-edit"><label>游戏昵称<input required maxLength={16} value={nickname} onChange={(event) => { setNickname(event.target.value); setNicknameError(null); }} placeholder="1–16 个字符" aria-invalid={nicknameError ? true : undefined}/></label><Button type="submit">保存昵称</Button></div>{nicknameError && <p className="ep-form-error" role="alert"><Icon name="alert" size={15}/> {nicknameError}</p>}<p className="ep-form-note"><Icon name="shield"/> 昵称全局唯一，重名会被拒绝；修改昵称不会改变账号、通关进度、当前座位或 Agent 记忆。</p></form></section>
          <section className="ep-player-card ep-email-card"><div className="ep-card-title"><span><Icon name="mail"/></span><div><h2>登录邮箱</h2><p>这是唯一日常登录标识；第一阶段不验证邮箱，也不能用于找回密码。</p></div><em className="is-pending">未验证</em></div><div className="ep-current-email"><small>CURRENT LOGIN EMAIL</small><strong>penguin@example.com</strong><span>仅作登录标识</span></div><div className="ep-card-actions"><Button variant="ghost" onClick={() => setDialog({ type: "changeEmail" })}>更换登录邮箱</Button></div></section>
          <section className="ep-player-card"><form className="ep-player-form" onSubmit={(event) => { event.preventDefault(); event.currentTarget.reset(); notify("密码已更新，旧会话已撤销"); }}><div className="ep-card-title"><span><Icon name="key"/></span><div><h2>修改个人密码</h2><p>需要当前密码；成功后当前设备获得新会话。</p></div></div><label>当前密码<input type="password" required/></label><div className="ep-field-row"><label>新密码<input type="password" minLength={8} required placeholder="至少 8 个字符"/></label><label>确认新密码<input type="password" minLength={8} required/></label></div><Button type="submit">保存新密码</Button></form></section>
          <section className="ep-player-card ep-session-card"><div className="ep-card-title"><span><Icon name="clock"/></span><div><h2>登录会话</h2><p>当前浏览器 · Singapore · 刚刚活跃</p></div><em className="is-current">当前</em></div><button type="button" onClick={() => notify("其他设备的会话已全部撤销")}><Icon name="logout"/> 退出其他所有设备</button></section>
        </div>
      </PlayerShell>
    );
  }

  return <>{page === "login" ? renderLogin() : page === "register" ? renderRegister() : renderSecurity()}{toast && <div className="ep-toast"><span><Icon name="check"/></span>{toast}</div>}{dialog?.type === "changeEmail" && <PlayerDialog setDialog={setDialog} notify={notify}/>}</>;
}

function PlayerDialog({ setDialog, notify }: { setDialog: React.Dispatch<React.SetStateAction<Dialog>>; notify: (message: string) => void }) {
  return <div className="ep-dialog-layer"><form className="ep-dialog" onSubmit={(event) => { event.preventDefault(); setDialog(null); notify("登录邮箱已更新；请使用新邮箱登录") }}><button type="button" className="ep-dialog__close" onClick={() => setDialog(null)}><Icon name="close"/></button><span className="ep-dialog__icon"><Icon name="mail"/></span><p className="ep-kicker">CHANGE LOGIN EMAIL</p><h2>更换登录邮箱</h2><p>输入当前密码后立即更换。新邮箱不会收到验证码，也不会被验证；请确认拼写正确。</p><label>当前密码<input type="password" required/></label><label>新邮箱<input type="email" required placeholder="new@example.com"/></label><Button type="submit">确认更换</Button></form></div>;
}
