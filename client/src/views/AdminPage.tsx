import React from "react";
import {
  ServerEvents,
  type AdminAccountListItem,
  type AdminActionResultPayload,
  type AdminEnterConfirmRequiredPayload,
  type RoomErrorPayload,
  type SeatId,
} from "@take-time/shared";
import { Button } from "../components/Button.js";
import { adapter } from "../socket/adapter.js";
import { socket } from "../socket/client.js";
import { useRoomStore } from "../store/useRoomStore.js";

type AdminSection = "accounts" | "room";
type AccountAction = "forceLogout" | "disable" | "restore" | "delete";

const sectionFromPath = (): AdminSection => window.location.pathname === "/admin/room" ? "room" : "accounts";
const formatDate = (value: number) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(value);
const STATUS_LABEL = { active: "正常", disabled: "已停用", deleted: "已删除" } as const;

export function AdminPage() {
  const connection = useRoomStore((state) => state.connectionState);
  const isAdmin = useRoomStore((state) => state.isAdmin);
  const room = useRoomStore((state) => state.roomState);
  const [section, setSection] = React.useState<AdminSection>(sectionFromPath);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [nick, setNick] = React.useState("管理员");
  const [accounts, setAccounts] = React.useState<AdminAccountListItem[]>([]);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "active" | "disabled" | "deleted">("all");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<AdminEnterConfirmRequiredPayload | null>(null);
  const [accountDialog, setAccountDialog] = React.useState<{ account: AdminAccountListItem; action: AccountAction } | null>(null);
  const [reason, setReason] = React.useState("");
  const [kickSeat, setKickSeat] = React.useState<SeatId | null>(null);

  const go = React.useCallback((next: AdminSection) => {
    const path = next === "room" ? "/admin/room" : "/admin/accounts";
    window.history.pushState({}, "", path);
    setSection(next);
    setError(null);
  }, []);

  const refreshAccounts = React.useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    adapter.adminAccountsList({ query: query.trim() || undefined, status });
  }, [isAdmin, query, status]);

  React.useEffect(() => {
    document.title = "管理台 · Best Duo";
    const onPop = () => setSection(sectionFromPath());
    const onList = ({ accounts: next }: { accounts: AdminAccountListItem[] }) => {
      setAccounts(next);
      setLoading(false);
    };
    const onAction = (payload: AdminActionResultPayload) => {
      setLoading(false);
      setNotice(payload.message);
      setAccountDialog(null);
      setKickSeat(null);
      adapter.adminAccountsList({ query: query.trim() || undefined, status });
    };
    const onConfirm = (payload: AdminEnterConfirmRequiredPayload) => setConfirm(payload);
    const onError = (payload: RoomErrorPayload) => {
      setLoading(false);
      setError(payload.code === "STALE_ADMIN_ACTION" ? "房间状态已变化，请核对最新座位后重试" : payload.message);
    };
    const onPlayerSession = () => window.location.assign("/");
    window.addEventListener("popstate", onPop);
    socket.on(ServerEvents.AdminAccountsListResult, onList);
    socket.on(ServerEvents.AdminActionResult, onAction);
    socket.on(ServerEvents.AdminEnterConfirmRequired, onConfirm);
    socket.on(ServerEvents.RoomError, onError);
    socket.on(ServerEvents.PlayerSession, onPlayerSession);
    return () => {
      window.removeEventListener("popstate", onPop);
      socket.off(ServerEvents.AdminAccountsListResult, onList);
      socket.off(ServerEvents.AdminActionResult, onAction);
      socket.off(ServerEvents.AdminEnterConfirmRequired, onConfirm);
      socket.off(ServerEvents.RoomError, onError);
      socket.off(ServerEvents.PlayerSession, onPlayerSession);
    };
  }, [query, status]);

  React.useEffect(() => {
    if (!isAdmin) return;
    if (window.location.pathname === "/admin") go("accounts");
  }, [isAdmin, go]);

  React.useEffect(() => {
    if (!isAdmin) return;
    const id = window.setTimeout(refreshAccounts, 250);
    return () => window.clearTimeout(id);
  }, [isAdmin, query, status, refreshAccounts]);

  const login = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password || connection !== "connected") return;
    setError(null);
    setLoading(true);
    adapter.adminLogin({ username: username.trim(), password, nick: nick.trim() || undefined, intent: "manage" });
  };

  const performAccountAction = () => {
    if (!accountDialog || !reason.trim()) return;
    setLoading(true);
    setError(null);
    const payload = { playerId: accountDialog.account.playerId, reason: reason.trim() };
    if (accountDialog.action === "forceLogout") adapter.adminAccountsForceLogout(payload);
    if (accountDialog.action === "disable") adapter.adminAccountsSetStatus({ ...payload, status: "disabled" });
    if (accountDialog.action === "restore") adapter.adminAccountsSetStatus({ ...payload, status: "active" });
    if (accountDialog.action === "delete") adapter.adminAccountsSoftDelete(payload);
  };

  const openAction = (account: AdminAccountListItem, action: AccountAction) => {
    setReason("");
    setNotice(null);
    setAccountDialog({ account, action });
  };

  if (!isAdmin) {
    return <div className="admin-login">
      <div className="admin-login__instrument" aria-hidden="true"><span>Ⅳ</span><i /></div>
      <form className="admin-login__card" onSubmit={login}>
        <a href="/" className="admin-login__brand">◷ BEST DUO</a>
        <p className="admin-kicker">CONTROL ROOM</p>
        <h1>管理台登录</h1>
        <p className="admin-login__intro">后台登录不会占用玩家座位，也不会中断当前对局。</p>
        <label htmlFor="admin-username">管理员账号</label>
        <input id="admin-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="admin-password">管理员密码</label>
        <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <label htmlFor="admin-nick">进入房间时的昵称</label>
        <input id="admin-nick" value={nick} maxLength={24} onChange={(event) => setNick(event.target.value)} />
        {error && <div className="account-notice account-notice--error" role="alert">{error}</div>}
        <Button type="submit" loading={loading || connection === "connecting" || connection === "reconnecting"} disabled={connection !== "connected" || !username.trim() || !password}>进入管理台</Button>
        <small>管理员凭证仅用于当前连接，不写入浏览器存储。</small>
      </form>
    </div>;
  }

  const occupied = room?.seats.filter((seat) => seat.nick) ?? [];
  const actionTitle = accountDialog ? ({ forceLogout: "强制退出", disable: "停用账号", restore: "恢复账号", delete: "删除账号" } as const)[accountDialog.action] : "";
  const confirmMessage = confirm?.inGame ? "进入房间会终止当前对局并请出所有玩家。" : `进入房间会请出当前 ${confirm?.humanSeatCount ?? 0} 名真人玩家。`;

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a href="/" className="admin-sidebar__brand">◷<strong>BEST DUO</strong><span>管理台</span></a>
      <nav>
        <button className={section === "accounts" ? "is-active" : ""} onClick={() => go("accounts")}><span>⌁</span>账号维护</button>
        <button className={section === "room" ? "is-active" : ""} onClick={() => go("room")}><span>◉</span>房间管理</button>
      </nav>
      <div className="admin-sidebar__foot"><i />已建立管理会话<button onClick={() => { adapter.adminLogout(); window.location.assign("/admin"); }}>退出</button></div>
    </aside>

    <main className="admin-main">
      <header className="admin-main__header">
        <div><p className="admin-kicker">{section === "accounts" ? "ACCOUNT LEDGER" : "LIVE ROOM"}</p><h1>{section === "accounts" ? "玩家账号维护" : "唯一房间管理"}</h1></div>
        <div className="admin-live"><i />服务在线 · {occupied.length}/{room?.capacity ?? 4} 座</div>
      </header>
      {error && <div className="account-notice account-notice--error" role="alert">{error}</div>}
      {notice && <div className="account-notice account-notice--success" role="status">{notice}</div>}

      {section === "accounts" ? <>
        <div className="admin-toolbar">
          <label><span>⌕</span><input aria-label="搜索账号" placeholder="搜索昵称、脱敏邮箱或账号 ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="账号状态" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option><option value="deleted">已删除</option></select>
          <Button variant="ghost" onClick={refreshAccounts} loading={loading}>刷新</Button>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table"><thead><tr><th>玩家</th><th>登录标识</th><th>状态</th><th>活动</th><th>创建日期</th><th>操作</th></tr></thead>
          <tbody>{accounts.map((account) => <tr key={account.playerId}>
            <td><div className="admin-player"><span>{(account.nickname ?? "?").slice(0, 1).toUpperCase()}</span><div><strong>{account.nickname ?? "已删除玩家"}</strong><small>{account.playerId.slice(0, 12)}…</small></div></div></td>
            <td>{account.maskedEmail ?? "—"}<small className="admin-unverified">未验证</small></td>
            <td><span className={`admin-status admin-status--${account.status}`}>{STATUS_LABEL[account.status]}</span></td>
            <td><span className={account.online ? "admin-online" : "admin-offline"}>{account.online ? "在线" : account.inSeat ? "座位保留" : "离线"}</span></td>
            <td>{formatDate(account.createdAt)}</td>
            <td><div className="admin-row-actions">
              {account.status !== "deleted" && <button onClick={() => openAction(account, "forceLogout")}>强退</button>}
              {account.status === "active" && <button onClick={() => openAction(account, "disable")}>停用</button>}
              {account.status === "disabled" && <button onClick={() => openAction(account, "restore")}>恢复</button>}
              {account.status !== "deleted" && <button className="is-danger" onClick={() => openAction(account, "delete")}>删除</button>}
            </div></td>
          </tr>)}</tbody></table>
          {!loading && accounts.length === 0 && <div className="admin-empty">没有符合条件的账号</div>}
        </div>
      </> : <>
        <section className="admin-room-summary">
          <div><span>当前阶段</span><strong>{room?.phase ?? "同步中"}</strong></div><div><span>状态版本</span><strong className="mono">#{room?.stateVersion ?? 0}</strong></div><div><span>当前关卡</span><strong>{room?.currentChallenge?.name ?? "未选择"}</strong></div>
          <Button onClick={() => adapter.adminEnterRoom({ nick: nick.trim() || "管理员" })}>以管理员身份进入房间</Button>
        </section>
        <section className="admin-seat-grid">
          {(room?.seats ?? []).map((seat) => <article key={seat.id} className={`admin-seat ${seat.nick ? "is-occupied" : ""}`}>
            <span className="admin-seat__letter">{seat.id}</span>
            <div><p>{seat.kind === "agent" ? "AGENT SEAT" : "PLAYER SEAT"}</p><h2>{seat.nick ?? "空座位"}</h2><small>{seat.nick ? `${seat.connected ? "在线" : "断线保留"}${room?.host === seat.id ? " · 房主" : ""}` : "等待玩家进入"}</small></div>
            {seat.nick && seat.kind === "human" && <button className="admin-seat__kick" onClick={() => setKickSeat(seat.id)}>请出</button>}
          </article>)}
        </section>
        <p className="admin-room-note">进入房间与后台管理相互独立。只有确认接管时，进行中的对局才会被终止。</p>
      </>}
    </main>

    {accountDialog && <div className="admin-dialog" role="dialog" aria-modal="true"><div className="admin-dialog__card"><p className="admin-kicker">AUDITED ACTION</p><h2>{actionTitle}</h2><p>目标：{accountDialog.account.nickname ?? accountDialog.account.playerId}</p><label htmlFor="admin-action-reason">操作原因（将写入审计）</label><textarea id="admin-action-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /><div><Button variant={accountDialog.action === "delete" ? "danger" : "primary"} loading={loading} disabled={!reason.trim()} onClick={performAccountAction}>确认{actionTitle}</Button><Button variant="ghost" onClick={() => setAccountDialog(null)}>取消</Button></div></div></div>}
    {kickSeat && <div className="admin-dialog" role="dialog" aria-modal="true"><div className="admin-dialog__card"><p className="admin-kicker">ROOM ACTION</p><h2>请出座位 {kickSeat}？</h2><p>若对局正在进行，将安全终止本局并返回等待大厅。</p><div><Button variant="danger" onClick={() => { if (room) adapter.adminKickPlayer({ seatId: kickSeat, stateVersion: room.stateVersion, reason: "管理员从管理台请出" }); }}>确认请出</Button><Button variant="ghost" onClick={() => setKickSeat(null)}>取消</Button></div></div></div>}
    {confirm && <div className="admin-dialog" role="alertdialog" aria-modal="true"><div className="admin-dialog__card"><p className="admin-kicker">ROOM TAKEOVER</p><h2>确认接管房间</h2><p>{confirmMessage}</p><div><Button variant="danger" onClick={() => adapter.adminSeizeRoom({ confirmedStateVersion: confirm.stateVersion })}>确认接管</Button><Button variant="ghost" onClick={() => setConfirm(null)}>取消</Button></div></div></div>}
  </div>;
}
