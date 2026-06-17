import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { mySeatIdSelector, hintLeftSelector } from "../store/selectors.js";
import { formatMmSs } from "../lib/timeFmt.js";
import { adapter } from "../socket/adapter.js";

const GAME_FLOW_PHASES = new Set(["levelSelect", "discussion", "placing", "reveal", "result"]);

const PHASE_LABEL: Record<string, string> = {
  waiting:     "待机中",
  levelSelect: "选择关卡",
  discussion:  "讨论中",
  placing:     "出牌",
  reveal:      "揭示",
  result:      "结算",
};

const CONN_LABEL: Record<string, string> = {
  connecting:   "连接中…",
  connected:    "",
  reconnecting: "正在恢复座位…",
  disconnected: "连接已断开",
};

export function TopBar() {
  const roomState  = useRoomStore((s) => s.roomState);
  const connState  = useRoomStore((s) => s.connectionState);
  const timer      = useRoomStore((s) => s.timer);
  const mySeatId   = useRoomStore(mySeatIdSelector);
  const hintLeft   = useRoomStore(hintLeftSelector);

  const [remaining, setRemaining] = React.useState<number | null>(null);
  const [confirmingEnd, setConfirmingEnd] = React.useState(false);
  React.useEffect(() => {
    if (!timer) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, timer.deadline - Date.now()));
    const id = setInterval(tick, 500);
    tick();
    return () => clearInterval(id);
  }, [timer]);

  const phase    = roomState?.phase ?? null;
  const levelNum = roomState?.currentChallenge?.levelIndex ?? roomState?.currentLevelIndex;
  const seats    = roomState?.seats ?? [];
  const ready    = roomState?.ready ?? {};
  const host     = roomState?.host ?? null;
  const hm       = roomState?.hintMarkers;

  const connLabel = CONN_LABEL[connState];
  const isDanger  = connState === "disconnected";

  return (
    <header className={`topbar${phase === "placing" ? " topbar--placing" : ""}`}>
      <span className="topbar__brand">◷ BEST DUO</span>

      {levelNum != null && (
        <span className="topbar__level mono">第 {levelNum} 关</span>
      )}

      {phase && (
        <span className="topbar__phase">{PHASE_LABEL[phase] ?? phase}</span>
      )}

      <div className="topbar__seats" aria-label="座位状态">
        {seats.map((seat) => (
          <span
            key={seat.id}
            className={[
              "topbar__seat-dot",
              seat.nick ? "topbar__seat-dot--occupied" : "",
              ready[seat.id] ? "topbar__seat-dot--ready" : "",
              seat.id === mySeatId ? "topbar__seat-dot--me" : "",
              seat.id === host ? "topbar__seat-dot--host" : "",
            ].filter(Boolean).join(" ")}
            title={seat.nick ?? "空缺"}
            aria-label={`座位 ${seat.id}: ${seat.nick ?? "空缺"}${ready[seat.id] ? " 已准备" : ""}${seat.id === host ? " 房主" : ""}`}
          />
        ))}
      </div>

      {hm && (phase === "placing" || phase === "discussion") && (
        <span className="topbar__hints" aria-label={`提示标记剩余 ${hintLeft}`}>
          {Array.from({ length: hm.total }).map((_, i) => (
            <span key={i} aria-hidden="true">{i < hm.used ? "◇" : "◆"}</span>
          ))}
        </span>
      )}

      {remaining !== null && (
        <span
          className={`topbar__timer mono${remaining < 30000 ? " topbar__timer--warn" : ""}`}
          aria-live="polite"
          aria-label={`剩余时间 ${formatMmSs(remaining)}`}
        >
          ⏱ {formatMmSs(remaining)}
        </span>
      )}

      {phase && GAME_FLOW_PHASES.has(phase) && (
        confirmingEnd ? (
          <span className="topbar__end-confirm">
            <span className="topbar__end-confirm-text">确认结束游戏？</span>
            <button
              className="btn btn--danger topbar__end-btn"
              onClick={() => { adapter.endGame(); setConfirmingEnd(false); }}
            >
              确认
            </button>
            <button
              className="btn btn--ghost topbar__end-btn"
              onClick={() => setConfirmingEnd(false)}
            >
              取消
            </button>
          </span>
        ) : (
          <button
            className="topbar__end-btn btn btn--danger"
            onClick={() => setConfirmingEnd(true)}
          >
            结束游戏
          </button>
        )
      )}

      {connLabel && (
        <span
          className={`topbar__conn${isDanger ? " topbar__conn--danger" : ""}`}
          aria-live="assertive"
        >
          {connLabel}
        </span>
      )}
    </header>
  );
}
