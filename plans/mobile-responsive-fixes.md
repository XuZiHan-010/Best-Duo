# 移动端响应式修复 · 前端设计方案

> 状态：**partially superseded / 历史参考**。TopBar 与 Reveal/Result 的结论仍可参考；placing 的禁止滚动、单屏塞入等旧假设已被 [2026-07-10 手机端方案](2026-07-10-mobile-gameplay-viewport-fixes.md) 替代。

> 适用范围：手机端（窄视口 ≤ 767px，尤其竖屏）。本文件仅是**设计方案**，给出可执行的 CSS 改法与前后对照，实施时再改代码。
> 关联文件：[client/src/styles/global.css](../client/src/styles/global.css)、[client/src/components/TopBar.tsx](../client/src/components/TopBar.tsx)、[client/src/views/Reveal.tsx](../client/src/views/Reveal.tsx)、[client/src/components/ClockBoard.tsx](../client/src/components/ClockBoard.tsx)。

## 1. 背景与现象

用户在手机端实测线上版本（best-duo.up.railway.app）发现两个移动端布局缺陷：

1. **顶部 topbar「锁死」**：最上面的状态栏（`◷ BEST DUO / 第 N 关 / 揭示 / 座位点 / 结束游戏`）内容被裁切，下拉也无法看到被遮挡的部分。
2. **揭示/结算画面竖屏堆叠**：时钟盘被压小，扇区卡片（截图中 S 区 12/12/9/4）互相重叠成一团；右侧「条件校验」列也被挤压，文字大量折行。

复现条件：手机竖屏，或浏览器窗口宽度 ≤ 767px。横屏或桌面端不出现。

## 2. 根因（已在代码中确认）

### 问题 1 — topbar 锁死

- [global.css:123](../client/src/styles/global.css#L123)：`.topbar` 为 `height: 48px`（**固定高**）+ `flex-wrap: wrap`。
- topbar 子项多：brand / level / phase / seats / hints / timer / 结束游戏按钮 / conn 状态（见 [TopBar.tsx](../client/src/components/TopBar.tsx)）。窄屏时这些项换行到 2~3 行，但容器高度被锁死在 48px，**溢出的行被裁剪、且自身没有滚动**（`.topbar` 是 `flex-shrink:0`，只有 `.room-view__main` 才 `overflow:auto`，见 [global.css:171](../client/src/styles/global.css#L171)）。
- 未使用 `env(safe-area-inset-top)`，在刘海屏/浏览器地址栏下会再被遮挡一截。
- 现有 `@media (max-width:767px)` 只对 `.topbar--placing` 隐藏 brand/phase/seats（[global.css:966-971](../client/src/styles/global.css#L966)）；**reveal / result / levelSelect / discussion 阶段没有任何裁剪**，完整 topbar 直接 wrap + clip。

### 问题 2 — 揭示结算竖屏堆叠

- [Reveal.tsx:34](../client/src/views/Reveal.tsx#L34)：`.reveal__main` 是**横向** flex = 时钟列 `flex:1` + 条件列**固定 `300px`**（[global.css:1136](../client/src/styles/global.css#L1136)、[1181](../client/src/styles/global.css#L1181)）。
- **整套 `.reveal` 样式没有任何 `@media` 移动端断点**。竖屏下固定 300px 的条件列吃掉大半宽度，时钟列被压窄。
- ClockBoard 为 `aspect-ratio:1; width:100%; max-width:460px`（[global.css:856](../client/src/styles/global.css#L856)），内部卡片堆是按 240×240 viewBox 百分比**绝对定位**的 HTML overlay（[ClockBoard.tsx:272](../client/src/components/ClockBoard.tsx#L272)，`SEGMENT_POSITIONS`）。盘面被压到很小后，卡片 overlay 是**固定像素尺寸**、不随盘面缩放 → 相邻扇区的卡片互相重叠（即截图现象）。

## 3. 设计原则

- **移动优先的渐进增强**：桌面端布局完全不动，所有修改收敛在 `@media (max-width:767px)` 与高度语义微调内。
- **高度用 `min-height` 而非 `height`**：让 topbar 在窄屏可以自然长高，不裁剪内容。
- **`100dvh` 取代 `100vh/100%`**（带 `100vh` fallback）：规避移动浏览器地址栏伸缩导致的视口跳动。
- **`env(safe-area-inset-*)` 适配刘海/手势条**：顶部、底部、左右安全区都让位。
- **时钟盘设最小可用尺寸下限**：保证盘面永远 ≥ 卡片 overlay 重叠的临界尺寸，从根上杜绝堆叠。

## 4. 方案 A — topbar 修复

### A1. 基础规则改高度 + 安全区（所有视口生效，桌面无副作用）

桌面端 topbar 永不换行，把 `height` 改成 `min-height` 不会改变其外观；窄屏换行时才会自然长高。

```css
/* 修改前（global.css:123） */
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  height: 48px;            /* ← 固定高，换行被裁 */
  background: var(--bg-2);
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* 修改后 */
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  min-height: 48px;        /* ← 允许长高，不裁剪 */
  /* 顶部 + 左右安全区让位（与原 padding 叠加） */
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: max(20px, env(safe-area-inset-left, 0px));
  padding-right: max(20px, env(safe-area-inset-right, 0px));
  background: var(--bg-2);
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
  flex-shrink: 0;
  flex-wrap: wrap;
  row-gap: 6px;            /* 换行时上下行留点间距 */
}
```

> 注：`html, body, #root { height: 100% }`（[global.css:9](../client/src/styles/global.css#L9)）可一并将 `.room-view` 的 `height: 100%`（[global.css:159](../client/src/styles/global.css#L159)）改为 `min-height: 100dvh`，让 topbar 长高后页面整体仍能正常滚动；该项为可选增强，桌面端无影响。

### A2. 窄屏裁剪推广到所有阶段

当前只有 placing 阶段精简（`.topbar--placing`）。把「窄屏只保留关键信息」的策略升级为对**所有阶段**生效：保留关卡号 / 计时 / 提示标记 / 结束游戏按钮，隐藏品牌名与阶段文字，座位点紧凑化。

```css
/* 新增 / 替换 global.css 中 @media (max-width:767px) 内的 topbar 段 */
@media (max-width: 767px) {
  /* 原仅 .topbar--placing 的隐藏，推广到全部阶段 */
  .topbar__brand,
  .topbar__phase {
    display: none;             /* 窄屏一律省去品牌与阶段文字 */
  }
  .topbar {
    gap: 10px;                 /* 窄屏收紧间距，减少换行 */
    font-size: 12px;
  }
  .topbar__seats { gap: 4px; }
  .topbar__seat-dot { width: 8px; height: 8px; }
  .topbar__end-btn { font-size: 12px; padding: 4px 12px; height: 28px; }
  /* 连接状态在窄屏占整行，避免把按钮挤到第三行 */
  .topbar__conn { flex-basis: 100%; text-align: right; }
}
```

> 说明：原 [global.css:967-971](../client/src/styles/global.css#L967) 的 `.topbar--placing .topbar__brand/__phase/__seats { display:none }` 中，对 `__seats` 的隐藏仅 placing 需要；本方案对全阶段隐藏 brand/phase，但**保留座位点**（仅缩小），因为非 placing 阶段座位状态仍有信息价值。实施时把原 placing 专用规则与此处合并去重即可。

### A3. 效果

- topbar 在窄屏可换行到 2 行且**完整可见**，不再裁剪、无需滚动。
- 刘海屏顶部安全区让位，内容不被状态栏/地址栏压住。
- 各阶段一致地只显示关键信息，降低换行行数。

## 5. 方案 B — 揭示结算竖屏重排

核心：窄屏下把 `.reveal__main` 从横向改为**纵向可滚动**，条件列下沉为全宽，并给时钟盘设最小尺寸下限防止卡片重叠。

### B1. 竖屏堆叠布局

```css
/* 新增：global.css 中 .reveal 区块后追加移动端断点 */
@media (max-width: 767px) {
  .reveal__main {
    flex-direction: column;     /* 横排 → 竖排 */
    overflow-y: auto;           /* 整体可纵向滚动 */
    gap: 0;
  }

  .reveal__clock-col {
    flex: none;                 /* 不再抢占/被压缩 */
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--hairline);
    padding: 16px;
  }
  /* 时钟盘设可用尺寸下限：宽度自适应但不小于该值，避免卡片 overlay 重叠 */
  .reveal__clock-col .clock-board {
    width: min(78vw, 300px);
    min-width: 240px;           /* ← 关键：低于此尺寸卡片会重叠 */
    max-width: 300px;
  }

  .reveal__conditions-col {
    width: 100%;                /* 固定 300px → 全宽 */
    flex-shrink: 1;
    border-top: 1px solid var(--hairline);
    padding: 16px;
    overflow-y: visible;        /* 滚动交给 .reveal__main */
  }

  /* 底部「继续 →」让位手势条 */
  .reveal__continue {
    padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  }
}
```

> 关于 `min-width: 240px`：ClockBoard 卡片 overlay 是固定像素尺寸（`.clock-segment-overlay { width:60px }`，[global.css:645](../client/src/styles/global.css#L645)）。盘面直径约等于 `clock-board` 宽度，需保证相邻扇区质心间距 > 卡片宽度。240px 是经验下限；实施时在 DevTools 中以最满的关卡（每段多张牌）实测微调，必要时同时把窄屏的 `.clock-segment-overlay` 与 `.placed-card` 略微缩小作为兜底。

### B2. 竖屏线框示意

```
┌─────────────────────────────┐
│ topbar（关卡/计时/提示/结束）  │  ← 方案 A，可换行完整可见
├─────────────────────────────┤
│        ✦ 通关！(banner)       │
├─────────────────────────────┤
│                             │
│        ◷  时钟盘             │  ← clock-col 全宽居中
│      (min 240 / max 300)    │     盘面足够大，卡片不重叠
│                             │
│   S1  S2  S3  S4  S5  S6     │  ← reveal__sums 一行/折行
│    7  10  13  15  17  28     │
├─────────────────────────────┤
│ 条件校验                     │  ← conditions-col 全宽下沉
│ ✓ 区1 恰好1张白牌            │
│ ✓ 区6 恰好3张               │
│ ✓ 区1≤区2≤…≤区6 非递减      │
│ ✓ 所有区段至少1张牌          │
├─────────────────────────────┤
│         [ 继续 → ]           │  ← 让位 safe-area-inset-bottom
└─────────────────────────────┘
        ↕ 整体可纵向滚动
```

### B3. 效果

- 时钟盘恒定 ≥ 240px，卡片不再重叠。
- 条件校验全宽展示，文字折行大幅减少，可读性提升。
- 内容超出一屏时整体可滚动；底部按钮不被手势条遮挡。

## 6. 影响面与回归提醒

- **桌面端零影响**：`height → min-height` 在不换行时等效；所有重排逻辑都在 `@media (max-width:767px)` 内。
- **`100dvh` 兼容性**：iOS Safari 15.4+ 支持 `dvh`；务必保留 `100vh`（或 `100%`）作为前一行 fallback。若不想引入 `dvh`，方案 B 的滚动已能独立成立，`dvh` 仅为锦上添花。
- **与既有 `.topbar--placing` 规则协同**：方案 A2 会与 [global.css:966-971](../client/src/styles/global.css#L966) 重叠，实施时合并去重，避免对 `__brand/__phase` 的重复声明。
- **placing 阶段移动布局**（[global.css:964-1029](../client/src/styles/global.css#L964)）已较完善，本次不动；只需确认 A1 的 `min-height` / 安全区改动不破坏其现有表现。

## 7. 验证方式

1. 本地启动：终端 1 `npm run dev`，终端 2 `npm run dev -w @take-time/client`，访问 http://localhost:5173 。
2. Chrome DevTools 设备模拟（iPhone 12/13，竖屏 390×844）逐阶段核对：
   - **topbar**：levelSelect / discussion / placing / reveal / result 各阶段，状态栏均完整可见、无裁剪。
   - **reveal**：用每段牌较多的关卡进入揭示，确认时钟盘卡片不重叠、条件列全宽可读、可滚动、按钮不被遮挡。
3. 切换横屏复测，确认未引入新的溢出。
4. 真机抽查一台刘海机型，确认 `env(safe-area-inset-*)` 让位生效（顶部不被状态栏压住、底部按钮不被手势条压住）。
