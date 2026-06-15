import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { mySeatIdSelector, isHostSelector, canStartSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { PlayerSeat } from "../components/PlayerSeat.js";
import { SettingsPanel } from "../components/SettingsPanel.js";
import { Button } from "../components/Button.js";

export function Lobby() {
  const roomState   = useRoomStore((s) => s.roomState);
  const connState   = useRoomStore((s) => s.connectionState);
  const mySeatId    = useRoomStore(mySeatIdSelector);
  const amHost      = useRoomStore(isHostSelector);
  const canStart    = useRoomStore(canStartSelector);
  const isOffline   = connState === "reconnecting" || connState === "disconnected";

  if (!roomState) {
    return (
      <div className="lobby">
        <p className="lobby__waiting">连接中…</p>
      </div>
    );
  }

  const { seats, ready, host, settings } = roomState;

  return (
    <div className="lobby">
      <div className="lobby__seats">
        {seats.map((seat) => (
          <PlayerSeat
            key={seat.id}
            id={seat.id}
            nick={seat.nick}
            isHost={seat.id === host}
            isReady={ready[seat.id] === true}
            isMe={seat.id === mySeatId}
            disabled={isOffline}
            onReady={() => adapter.ready()}
            onCancelReady={() => adapter.ready()}
          />
        ))}
      </div>

      <SettingsPanel settings={settings} isHost={amHost && !isOffline} />

      {isOffline && (
        <p className="lobby__waiting">正在恢复连接，操作暂停…</p>
      )}

      {!isOffline && amHost && canStart && (
        <div className="lobby__start">
          <Button onClick={() => adapter.startGame()}>开始游戏</Button>
        </div>
      )}

      {!isOffline && amHost && !canStart && (
        <p className="lobby__waiting">等待所有玩家就座并准备…</p>
      )}

      {!isOffline && !amHost && (
        <p className="lobby__waiting">等待房主开始游戏…</p>
      )}
    </div>
  );
}
