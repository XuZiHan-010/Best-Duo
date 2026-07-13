import type { RoomSettings } from "@take-time/shared";
import { Pill } from "./Pill.js";
import { adapter } from "../socket/adapter.js";

interface SettingsPanelProps {
  settings: RoomSettings;
  isHost: boolean;
}

const DISCUSSION_OPTIONS = [
  { value: 5 as const, label: "5 分" },
  { value: 10 as const, label: "10 分" },
  { value: 15 as const, label: "15 分" },
  { value: 20 as const, label: "20 分" },
];

const THINK_OPTIONS = [
  { value: 5 as const, label: "5 秒" },
  { value: 10 as const, label: "10 秒" },
  { value: 15 as const, label: "15 秒" },
  { value: 20 as const, label: "20 秒" },
  { value: 30 as const, label: "30 秒" },
];

const HINT_OPTIONS = [
  { value: 2 as const, label: "2 个" },
  { value: 3 as const, label: "3 个" },
  { value: 4 as const, label: "4 个" },
];

export function SettingsPanel({ settings, isHost }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">
        游戏设置
        {!isHost && (
          <span className="settings-panel__readonly-note">（仅房主可调整）</span>
        )}
      </h2>

      <div className="settings-panel__row">
        <span className="settings-panel__label">讨论时间</span>
        <Pill
          name="讨论时间"
          options={DISCUSSION_OPTIONS}
          value={settings.discussionMinutes}
          disabled={!isHost}
          onChange={(v) => adapter.updateSettings({ discussionMinutes: v })}
        />
      </div>

      <div className="settings-panel__row">
        <span className="settings-panel__label">思考时间</span>
        <Pill
          name="思考时间"
          options={THINK_OPTIONS}
          value={settings.thinkSeconds}
          disabled={!isHost}
          onChange={(v) => adapter.updateSettings({ thinkSeconds: v })}
        />
      </div>

      <div className="settings-panel__row">
        <span className="settings-panel__label">提示标记</span>
        <Pill
          name="提示标记数量"
          options={HINT_OPTIONS}
          value={settings.hintMarkerCount}
          disabled={!isHost}
          onChange={(v) => adapter.updateSettings({ hintMarkerCount: v })}
        />
        <span className="settings-panel__hint-note">（全队共用）</span>
      </div>

      <div className="settings-panel__row settings-panel__row--note">
        <span className="settings-panel__label">开局人数</span>
        <span className="settings-panel__static">2-4 名玩家</span>
        <span className="settings-panel__hint-note">真人和 AI 均可；所有真人准备后即可开始。</span>
      </div>
    </div>
  );
}
