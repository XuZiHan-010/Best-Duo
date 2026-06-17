// client/src/views/LevelSelect.tsx
import React from "react";
import { useRoomStore } from "../store/useRoomStore.js";
import { isHostSelector } from "../store/selectors.js";
import { adapter } from "../socket/adapter.js";
import { CountdownTimer } from "../components/CountdownTimer.js";

export function LevelSelect() {
  const roomState = useRoomStore((s) => s.roomState);
  const isHost    = useRoomStore(isHostSelector);
  const connState = useRoomStore((s) => s.connectionState);
  const isOffline = connState === "reconnecting" || connState === "disconnected";

  if (!roomState) return null;

  const cleared = roomState.progress.clearedLevels;
  const { levelSummaries, timer } = roomState;
  const levelSelectTimer = timer?.kind === "levelSelect" ? timer : null;

  return (
    <div className="level-select">
      <div className="level-select__header">
        <span className="level-select__progress">
          已通关 {cleared.length} / {levelSummaries.length}
        </span>
        <div className="level-select__header-right">
          {levelSelectTimer && (
            <span className="level-select__timer-label">
              {isHost ? "房主选关" : "等待房主选关"}
              <CountdownTimer
                deadline={levelSelectTimer.deadline}
                warnThresholdMs={10_000}
                dangerThresholdMs={5_000}
                className="level-select__countdown"
              />
            </span>
          )}
          <span className="level-select__legend">
            <span className="level-select__legend-item level-select__legend-item--cleared">
              ✓ 已通关
            </span>
            <span className="level-select__legend-item level-select__legend-item--locked">
              🔒 未解锁
            </span>
          </span>
        </div>
      </div>

      {isOffline && (
        <p className="level-select__waiting" aria-live="polite">
          正在恢复连接，操作暂停…
        </p>
      )}

      <div className="level-select__grid" role="list" aria-label="关卡列表">
        {levelSummaries.map((summary) => {
          const levelNum = summary.levelIndex;
          const isCleared = cleared.includes(levelNum);
          // 顺序解锁：第 1 关始终开放；其余关卡需上一关已通关才解锁。
          const isUnlocked = levelNum === 1 || cleared.includes(levelNum - 1);
          const isLocked = !isUnlocked;
          const cls = [
            "level-select__card",
            isCleared ? "level-select__card--cleared" : "",
            isLocked  ? "level-select__card--locked"  : "",
            !isHost   ? "level-select__card--readonly" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const stateSuffix = isCleared ? "（已通关）" : isLocked ? "（未解锁）" : "";
          const label = `第 ${levelNum} 关 ${summary.name}${stateSuffix}`;
          const content = (
            <>
              <span className="level-select__num">{levelNum}</span>
              <span className="level-select__name">{summary.name}</span>
              {isCleared && (
                <span className="level-select__cleared-badge" aria-hidden="true">
                  ✓
                </span>
              )}
              {isLocked && (
                <span className="level-select__lock-badge" aria-hidden="true">
                  🔒
                </span>
              )}
            </>
          );
          const canSelect = isHost && isUnlocked;
          return (
            <div key={summary.id} role="listitem" className="level-select__card-slot">
              {canSelect ? (
                <button
                  className={cls}
                  onClick={!isOffline ? () => adapter.selectLevel({ levelIndex: levelNum }) : undefined}
                  disabled={isOffline}
                  aria-label={label}
                >
                  {content}
                </button>
              ) : (
                <div
                  className={cls}
                  aria-label={label}
                  aria-disabled={isLocked ? true : undefined}
                >
                  {content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
