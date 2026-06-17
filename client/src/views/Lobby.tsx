import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { mySeatIdSelector, isHostSelector, canStartSelector, allReadySelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { PlayerSeat } from "../components/PlayerSeat.js";
import { SettingsPanel } from "../components/SettingsPanel.js";
import { Button } from "../components/Button.js";

const GRACE_SECONDS = 15;

export function Lobby() {
  const roomState   = useRoomStore((s) => s.roomState);
  const connState   = useRoomStore((s) => s.connectionState);
  const mySeatId    = useRoomStore(mySeatIdSelector);
  const amHost      = useRoomStore(isHostSelector);
  const canStart    = useRoomStore(canStartSelector);
  const allReady    = useRoomStore(allReadySelector);
  const isOffline   = connState === "reconnecting" || connState === "disconnected";

  const [countdown, setCountdown] = React.useState(GRACE_SECONDS);

  React.useEffect(() => {
    setCountdown(GRACE_SECONDS);
    if (!allReady) return;
    const id = setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [allReady]);

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
            avatar={seat.avatar}
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
          {allReady && (
            <p className="lobby__host-warning">
              请在 <strong>{countdown}</strong> 秒内开始，否则将自动换届
            </p>
          )}
        </div>
      )}

      {!isOffline && amHost && !canStart && (
        <p className="lobby__waiting">等待所有玩家就座并准备…</p>
      )}

      {!isOffline && !amHost && (
        <p className="lobby__waiting">
          等待房主开始游戏…
          {allReady && <span className="lobby__countdown">（剩余 {countdown} 秒）</span>}
        </p>
      )}
    </div>
  );
}
