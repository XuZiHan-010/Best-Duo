import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { TopBar } from "../components/TopBar.js";
import { KickedNotice } from "../components/KickedNotice.js";
import { Login } from "./Login.js";
import { Lobby } from "./Lobby.js";
import { LevelSelect } from "./LevelSelect.js";
import { Discussion } from "./Discussion.js";
import { Placing } from "./Placing.js";
import { Reveal } from "./Reveal.js";
import { Result } from "./Result.js";

function PhaseView() {
  const phase  = useRoomStore((s) => s.roomState?.phase);
  const myNick = useRoomStore((s) => s.myNick);

  if (!myNick) return <Login />;

  switch (phase) {
    case "waiting":     return <Lobby />;
    case "levelSelect": return <LevelSelect />;
    case "discussion":  return <Discussion />;
    case "placing":     return <Placing />;
    case "reveal":      return <Reveal />;
    case "result":      return <Result />;
    default:            return <Lobby />;
  }
}

export function RoomView() {
  const lastError  = useRoomStore((s) => s.lastError);
  const clearError = useRoomStore((s) => s.clearError);
  // Login 页面自己处理 join 错误的内联展示，避免双重显示（Bug 5）
  const myNick     = useRoomStore((s) => s.myNick);
  const kickNotice = useRoomStore((s) => s.kickNotice);
  const showToast  = lastError !== null && myNick !== null;

  React.useEffect(() => {
    if (myNick && window.location.pathname === "/account/register") {
      window.history.replaceState({}, "", "/");
    }
  }, [myNick]);

  if (kickNotice) return <KickedNotice reason={kickNotice} />;

  return (
    <div className="room-view">
      <a href="#main-content" className="skip-link">跳到主内容</a>
      <TopBar />
      {showToast && (
        <div className="toast toast--error" role="alert">
          <span>{lastError!.message}</span>
          <button onClick={clearError} aria-label="关闭错误提示">✕</button>
        </div>
      )}
      <main id="main-content" className="room-view__main">
        <PhaseView />
      </main>
    </div>
  );
}
