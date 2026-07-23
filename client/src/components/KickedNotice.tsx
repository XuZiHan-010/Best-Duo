import React, { useEffect, useRef } from "react";
import type { KickReason } from "@take-time/shared";
import { useRoomStore } from "../store/useRoomStore.js";

const MESSAGES: Record<KickReason, string> = {
  ADMIN_SEIZED_ROOM: "管理员已强制结束当前游戏，您已被请出房间",
  KICKED_BY_ADMIN: "你已被管理员请出房间",
  ACCOUNT_FORCE_LOGOUT: "管理员已强制退出你的账号，请重新登录",
  ACCOUNT_DISABLED: "账号已被停用，如有疑问请联系管理员",
  ACCOUNT_DELETED: "账号已被删除",
};

// 被管理员请出的终态提示：本地会话已清除，不做任何自动重连，
// 玩家确认后回到登录页（myNick 已清空，RoomView 自然落回 Login）。
export function KickedNotice({ reason }: { reason: KickReason }) {
  const setKickNotice = useRoomStore((s) => s.setKickNotice);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  return (
    <div className="kicked-notice" role="alertdialog" aria-modal="true" aria-labelledby="kicked-title">
      <div className="kicked-notice__card">
        <h2 id="kicked-title" className="kicked-notice__title">
          {MESSAGES[reason]}
        </h2>
        <button
          ref={btnRef}
          className="btn btn--primary kicked-notice__btn"
          onClick={() => setKickNotice(null)}
        >
          返回登录
        </button>
      </div>
    </div>
  );
}
