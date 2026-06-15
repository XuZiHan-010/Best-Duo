# M2 前端设计规格 — 选关 + 讨论 + 钟盘骨架

> 日期：2026-06-15
> 参考：[frontend-ui-plan.md](../../../plans/frontend-ui-plan.md)、[take-time-web-prototype.md](../../../plans/take-time-web-prototype.md)
> 本文只记录 M2 的**范围决策**与**本次头脑风暴中确认的视觉决策**；完整 UI 规格见 frontend-ui-plan.md。

---

## 1. M2 范围

| 包含 | 不包含 |
|------|--------|
| `LevelSelect` 视图（选关网格 + 通关标记） | 出牌三栏布局（M3） |
| `Discussion` 视图（讨论主界面） | 手牌 / 暗置牌渲染（M3） |
| `LevelRulesIntro` 模态弹窗（进关规则说明） | 提示弹窗 HintPrompt（M4） |
| `ClockBoard` SVG 骨架（空钟盘，含 6 段 + 标签 + centerCap） | 钟盘内牌堆渲染（M3） |
| `ConditionList` 组件（条件 → 中文） | 揭示 / 结算（M5） |
| `RulesPanel` 讨论/出牌左侧常驻规则面板 | |
| `Chat` 聊天组件 | |
| `CountdownTimer` 倒计时组件 | |
| `lib/conditionText.ts` 条件文案映射 | |
| 所有组件的 CSS（追加到 global.css） | |

**范围说明**：原 M2 不含 ClockBoard，但由于钟盘是讨论页核心视觉且 M3 只需增量添牌，在 M2 顺手建好 SVG 骨架成本低、收益高（讨论联调真实）。

---

## 2. 视觉决策（头脑风暴确认）

### 2.1 讨论页布局
**选定：方案 B**
```
┌ TopBar ────────────────────────────────────── ⏱ 倒计时 ─┐
┌── 钟面预览（左，约60%）──┐  ┌── 聊天（右，约40%）──────┐
│  ClockBoard（空钟盘）     │  │ 消息列表                   │
│  [▶ 提前开始出牌]（房主） │  │ [输入…] [发送]             │
└──────────────────────────┘  └────────────────────────────┘
┌── 本关条件（全宽底部条）──────────────────────────────────┐
│  • 区2 总和 12–16   • 区6 最多 3 张   • 所有区段≥1 张     │
└────────────────────────────────────────────────────────────┘
```

### 2.2 ClockBoard SVG 风格
**选定：时钟盘式（A 款）**
- 外圈：12 刻度线 + 细刻度环（`--brass` 低透明度）
- 6 段分割：从中心圆边缘到外圈的辐射线（`rotate(N*60deg)`）
- 淡色扇形背景（`opacity: 0.06~0.08`，区分各段）
- 中心圆：显示 `centerCap`（数字）或 `∞`（null）

### 2.3 区段标签（S1–S6）位置
**选定：外圈**（紧贴钟盘外侧，位于每段 60° 弧中点，`r ≈ 88px`）
- 理由：区段内出牌阶段会有牌堆，内部标签会被遮住

---

## 3. 新增组件清单

| 组件 / 文件 | 职责 | 复用于 |
|------------|------|--------|
| `lib/conditionText.ts` | Condition → 中文映射 | ConditionList、Reveal |
| `components/ConditionList.tsx` | 渲染条件清单 | LevelRulesIntro、RulesPanel、Reveal |
| `components/ClockBoard.tsx` | SVG 钟盘骨架（6 段 + 标签 + centerCap） | Discussion、Placing、Reveal |
| `components/CountdownTimer.tsx` | 倒计时显示（tabular-nums + aria-live + 危险态） | Discussion、Placing |
| `components/Chat.tsx` | 聊天消息列表 + 输入框 | Discussion |
| `components/LevelRulesIntro.tsx` | 进关规则说明模态弹窗 | Discussion 入口 |
| `components/RulesPanel.tsx` | 左侧常驻精简规则面板 | Discussion、Placing |
| `views/LevelSelect.tsx` | 选关网格视图 | — |
| `views/Discussion.tsx` | 讨论主视图（整合上述组件） | — |

---

## 4. 关键接口约定

### ClockBoard props
```ts
interface ClockBoardProps {
  centerCap: number | null;          // null → 显示 ∞
  placements: PublicPlacedCard[][];  // M2 传空数组即可，M3 填充
  // 尺寸：SVG 用 viewBox="0 0 240 240" + width/height="100%"，由父容器决定实际大小，不传固定 px
  interactive?: boolean;             // M3 出牌时 true（区段可点击）
  onSegmentClick?: (seg: number) => void; // M3 用，M2 不传
}
```

### LevelRulesIntro 显隐
- Discussion 视图内 `const [rulesAccepted, setRulesAccepted] = useState(false)`
- `rulesAccepted === false` 时渲染 `<LevelRulesIntro>`（全屏遮罩），点击「已了解，开始讨论」后 `setRulesAccepted(true)`
- 状态纯本地，不写入 store；每次进入 discussion phase 都会重新弹出（刷新 / 重连后同理）

### ConditionList props
```ts
interface ConditionListProps {
  conditions: Condition[];
  results?: ConditionResult[]; // Reveal 阶段传入，显示 ✓/✗
  compact?: boolean;           // RulesPanel 精简模式
}
```

### CountdownTimer props
```ts
interface CountdownTimerProps {
  deadline: number; // Date.now() 时间戳（毫秒）
  warnThresholdMs?: number; // 默认 30000（最后 30s 转警告色）
}
```

---

## 5. CSS 新增节（追加到 global.css）

需要追加的 CSS 节（实现时详细展开）：
- `.level-select` — 选关页容器、网格、卡片、通关印章
- `.level-rules-intro` — 模态遮罩、卡片、条件清单、图例
- `.clock-board` — SVG 容器（响应式等比缩放）
- `.discussion` — 两栏 + 底部条件栏布局
- `.rules-panel` — 左侧精简规则面板
- `.chat` — 消息列表、气泡、输入行
- `.countdown-timer` — tabular-nums，危险态脉冲

---

## 6. 不在本规格内

- 手牌可见性逻辑（M3）
- 出牌交互（M3）
- 提示标记弹窗（M4）
- 揭示动画 / 结算（M5）
- Playwright E2E 测试（M6）
