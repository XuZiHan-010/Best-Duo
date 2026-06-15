// client/src/views/LevelSelect.tsx
import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { isHostSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";

const TOTAL_LEVELS = 10; // 随 levels/ 文件夹关卡增加而更新

export function LevelSelect() {
  const roomState = useRoomStore((s) => s.roomState);
  const isHost    = useRoomStore(isHostSelector);

  if (!roomState) return null;

  const cleared = roomState.progress.clearedLevels;

  return (
    <div className="level-select">
      <div className="level-select__header">
        <span className="level-select__progress">
          已通关 {cleared.length} / {TOTAL_LEVELS}
        </span>
        <span className="level-select__legend">
          <span className="level-select__legend-item level-select__legend-item--cleared">
            ✓ 已通关
          </span>
        </span>
      </div>

      {!isHost && (
        <p className="level-select__waiting" aria-live="polite">
          等待房主选关…
        </p>
      )}

      <div className="level-select__grid" role="list" aria-label="关卡列表">
        {Array.from({ length: TOTAL_LEVELS }).map((_, i) => {
          const levelNum = i + 1;
          const isCleared = cleared.includes(i);
          return (
            <button
              key={i}
              role="listitem"
              className={[
                "level-select__card",
                isCleared ? "level-select__card--cleared" : "",
                !isHost   ? "level-select__card--readonly" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={isHost ? () => adapter.selectLevel({ levelIndex: i }) : undefined}
              disabled={!isHost}
              aria-label={`第 ${levelNum} 关${isCleared ? "（已通关）" : ""}`}
            >
              <span className="level-select__num">{levelNum}</span>
              {isCleared && (
                <span className="level-select__cleared-badge" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
