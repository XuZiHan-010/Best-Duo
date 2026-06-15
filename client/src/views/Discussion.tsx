// client/src/views/Discussion.tsx
import React, { useState } from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { isHostSelector, mySeatIdSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { LevelRulesIntro } from "../components/LevelRulesIntro.js";
import { ClockBoard } from "../components/ClockBoard.js";
import { ConditionList } from "../components/ConditionList.js";
import { Chat } from "../components/Chat.js";

export function Discussion() {
  const roomState = useRoomStore((s) => s.roomState);
  const isHost    = useRoomStore(isHostSelector);
  const mySeatId  = useRoomStore(mySeatIdSelector);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  if (!roomState?.currentChallenge) {
    return <div className="view-stub">加载关卡中…</div>;
  }

  const { currentChallenge, chat, placements } = roomState;

  if (!rulesAccepted) {
    return (
      <LevelRulesIntro
        levelName={currentChallenge.name}
        difficulty={currentChallenge.difficulty}
        conditions={currentChallenge.conditions}
        onAccept={() => setRulesAccepted(true)}
      />
    );
  }

  return (
    <div className="discussion">
      <div className="discussion__main">
        {/* 左栏：钟面预览 + 房主提前开始按钮 */}
        <div className="discussion__clock-col">
          <ClockBoard
            centerCap={currentChallenge.centerCap}
            placements={placements}
          />
          {isHost && (
            <button
              className="btn btn--ghost discussion__begin-btn"
              onClick={() => adapter.beginPlacement()}
            >
              ▶ 提前开始出牌
            </button>
          )}
          {!isHost && (
            <p className="view-stub" style={{ fontSize: 13 }}>
              等待房主或倒计时结束…
            </p>
          )}
        </div>

        {/* 右栏：聊天 */}
        <div className="discussion__chat-col">
          <Chat messages={chat} mySeatId={mySeatId} />
        </div>
      </div>

      {/* 底部：本关条件清单（横向） */}
      <div className="discussion__conditions" aria-label="本关目标">
        <ConditionList conditions={currentChallenge.conditions} />
      </div>
    </div>
  );
}
