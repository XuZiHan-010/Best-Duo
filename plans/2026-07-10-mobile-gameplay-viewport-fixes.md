# 手机端转盘、滚动与横竖屏切换修复方案

> 状态：**implemented / verification pending**。结构性改动已基本落地，仍需完成全量 Playwright 与真机回归；移动端 placing/discussion 的现行口径以本文为准。

> 日期：2026-07-10  
> 范围：讨论阶段（`Discussion`）与出牌阶段（`Placing`）的手机竖屏、手机横屏和旋转场景  
> 目标：解决“轮到你出牌”状态条被转盘遮挡且无法滚动、横屏后转盘区域锁死、竖屏等待提示挤压或遮挡转盘三个问题。本文只定义前端实施方案，不修改服务端状态或游戏规则。

与既有 [mobile-responsive-fixes.md](mobile-responsive-fixes.md) 的关系：旧方案对顶部栏和揭示页的结论仍可参考；其中“placing 移动布局已完善、本次不动”以及 `no-scroll` 假设已被本轮真机问题否定，涉及出牌页滚动与测试的部分以本文为准。

## 1. 结论

本次不应继续维持“手机出牌页必须完全塞进一屏、禁止滚动”的旧约束。正确方案是：

1. 由 `.room-view__main` 作为游戏页唯一的纵向滚动容器；讨论页和出牌页不再裁切内容，也不创建互相竞争的页面级纵向滚动区。
2. 响应式判断从“只看宽度”升级为“宽度 + 方向 + 可用高度”；手机横屏不能因为宽度超过 `767px` 就套用桌面三栏和超大转盘。
3. 转盘尺寸同时受宽度和高度约束，但不通过无限压缩来硬塞入一屏；空间不足时保留可操作尺寸并允许页面滚动。
4. “轮到你出牌”“等待房主或倒计时结束”等状态都进入正常文档流，使用专用状态组件/样式，不复用带 `flex: 1` 的加载占位样式。
5. 更新自动化测试，删除当前错误的 `no-scroll` 契约，改为验证“无重叠、无裁切、可滚动到达、旋转后自动重排”。

## 2. 截图与页面对应关系

- 竖屏手牌截图属于出牌页：`Placing.tsx` 中的 `.placing__turn-badge`、`.clock-board`、回合信息条和手牌区。
- 带聊天框、底部关卡条件以及“等待房主或倒计时结束”的截图属于讨论页：`Discussion.tsx` 中的 `.discussion__clock-col`、`.discussion__chat-col` 和 `.discussion__conditions`。

因此不能只修 `.placing`；至少要同时覆盖 `Discussion` 与 `Placing`，否则横屏和等待态仍会复现。

## 3. 已确认根因

### 3.1 出牌页主动禁止了移动端滚动

当前 [global.css](../client/src/styles/global.css) 在 `@media (max-width: 767px)` 中设置：

```css
.placing {
  flex-direction: column;
  overflow: hidden;
}
```

同时 `.placing__center` 使用 `flex: 1; min-height: 0`，转盘、回合状态条和转盘外围条件徽标只能争抢剩余高度。空间不足时，内容会被压缩或裁切；用户也无法通过纵向滚动找回被裁掉的“轮到你出牌”。

现有 [mobile-placing-layout.spec.ts](../client/e2e/mobile-placing-layout.spec.ts) 还明确把 `no-scroll` 和“所有元素都必须位于首屏”作为测试目标，导致错误布局被自动化测试固化。

### 3.2 转盘的可视内容超出自身方形边界

`ClockBoard` 的 S1–S6 标签、条件徽标和幽灵卡堆通过绝对定位分布在圆盘边缘，部分锚点半径大于 SVG 的半径；成对徽标还会水平偏移 `30px`。所以 `.clock-board` 的 CSS 方框不是完整的视觉边界。

当 `.placing__turn-badge` 与 `.clock-board` 之间只有 `10px` gap、父容器又被强制压缩时，外围徽标容易侵入回合状态条区域，看起来像“转盘盖住上方 tab”。单纯提高 `z-index` 只能改变谁盖住谁，不能解决空间不足。

### 3.3 手机横屏误入桌面/平板布局

当前核心断点仅为 `max-width: 767px`。iPhone 横屏的 CSS 视口常见为 `844×390` 或相近尺寸，宽度超过 `767px` 后会进入三栏/双栏桌面布局，但可用高度只有约 390px：

- 出牌页仍使用左右固定栏和最大 `460px` 的转盘；
- 讨论页仍为“左转盘 + 右聊天 + 底部条件”的桌面双栏；
- `.discussion__clock-col` 使用 `justify-content: center`，当内容高于容器时会同时向顶部和底部溢出，顶部负向溢出无法靠滚动找回；
- 地址栏伸缩及旋转后的 visual viewport 高度变化会进一步压缩内容。

这就是横屏后转盘被截断、页面看似锁死且无法上下拉动的主要原因。

### 3.4 讨论页等待提示错误复用了加载占位样式

[Discussion.tsx](../client/src/views/Discussion.tsx) 中的非房主等待提示和断线提示使用 `.view-stub`。而 `.view-stub` 的全局定义包含 `flex: 1`，本意是让整页“加载中”占满剩余空间，并不适合放在转盘列内部。

结果是等待提示会吞掉剩余高度、制造大片空白，并挤压转盘、聊天区或底部条件栏。竖屏时这种挤压尤其明显。

### 3.5 视口与安全区处理不完整

- `html, body, #root` 和 `.room-view` 依赖 `height: 100%`，没有明确使用动态视口高度；移动 Safari 地址栏伸缩或横竖屏切换后容易产生旧高度与当前可视高度不一致的瞬间。
- [index.html](../client/index.html) 的 viewport meta 未声明 `viewport-fit=cover`，已有的 `env(safe-area-inset-*)` 在刘海屏/圆角屏上的效果不完整。
- 底部手牌与条件栏需要同时考虑 `safe-area-inset-bottom` 和浏览器工具栏，不应仅靠“首屏内可见”假设。

## 4. 布局架构

### 4.1 只保留一个页面级纵向滚动容器

以 `.room-view__main` 为唯一的游戏内容滚动所有者：

```css
html,
body,
#root {
  height: 100%;
}

body {
  min-height: 100vh;   /* fallback */
  min-height: 100dvh;
}

.room-view {
  height: 100vh;       /* fallback */
  height: 100dvh;
  min-height: 0;
}

.room-view__main {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
```

> 注：不写 `overflow-x: clip`——按 CSS Overflow 规范，一轴为 `clip`、另一轴为滚动值时 `clip` 的计算值就是 `hidden`，直接写 `hidden` 与实际行为一致。

实施时应根据 iOS Safari 实测在以下两种壳层策略中固定一种，不能混用：

- 首选：`.room-view` 固定为当前 `100dvh`，顶部栏在滚动容器之外保持可见，`.room-view__main` 单独滚动；
- 兼容回退：不支持 `dvh` 时使用 `100vh/100%`，仍由 `.room-view__main` 滚动。

讨论页、出牌页不得再使用 `overflow: hidden` 裁切正常内容；聊天记录 `.chat__list` 可继续保留组件内部滚动，因为它是独立的信息列表，不是页面布局滚动。

**该改动是全局的，波及所有阶段视图。** `.room-view__main` 是 Lobby、LevelSelect、Discussion、Placing、Reveal、Result 的公共容器，不能只按 Discussion/Placing 的口径验收：

- Reveal 移动端已有自己的 `.reveal__main { overflow-y: auto }`（global.css ≤767px 块内），与新的页面级滚动容器构成嵌套滚动，会产生滚动链抢占和 e2e 断言歧义。实施时删除该 `overflow-y: auto`，Reveal 的纵向滚动统一交还 `.room-view__main`。
- Lobby、LevelSelect、Result 虽不改布局，也必须做布局冒烟回归（见 §9.5），确认 `min-height: 100%` 与单一滚动容器没有引入空白或双滚动条。

### 4.2 允许内容超过首屏

移动端 `.placing`、`.discussion` 的高度应由内容决定，并至少填满可用区域：

```css
@media (max-width: 767px),
       (orientation: landscape) and (max-height: 600px) {
  .placing,
  .discussion {
    flex: 0 0 auto;
    min-height: 100%;
    overflow: visible;
  }
}
```

若实际 flex 计算中 `min-height: 100%` 兼容性不稳定，可给 `.room-view__main` 增加 `display: block` 的移动端覆盖，或给阶段根节点使用 `min-block-size: 100%`；不要重新引入子级 `height: 100% + overflow: hidden`。

### 4.3 现有 `≤767px` 媒体块的规则迁移清单

global.css 现有的 `@media (max-width: 767px)` 块混含大量与方向无关的规则。小屏横屏手机（如 iPhone SE 横屏 `667×375`）会**同时命中**“≤767px”与新的“landscape ≤600px 高”两个块：若把整块改为 portrait-only，横屏会丢失 topbar 裁剪等必需规则；若原样保留，旧的 `.placing__center { flex: 1; min-height: 0 }`、`.placing__right { order: 2; flex-direction: row }` 等会与新 grid 布局叠加冲突。实施时按下面三类处理，不允许"整块照搬"或"整块加 orientation"：

1. **保持 `≤767px` 双方向生效**（与方向无关的紧凑化）：topbar 裁剪与压缩、`.topbar__conn`、lobby 座位堆叠、`.player-seat`、`.hand-rail` 三列网格、队友列表横排（含文件尾部第二个 767px 块）。
2. **迁移到 `(max-width: 767px) and (orientation: portrait)`**（竖屏专属布局）：`.placing` 纵向列与 `order` 重排、`.placing__center`/`.placing__left`/`.placing__right` 的竖屏尺寸与边框、§6.2 新增的讨论页竖屏规则、Reveal 的纵向布局（其 `overflow-y: auto` 按 §4.1 删除）。
3. **由 landscape 块显式覆盖**：短横屏 grid 规则必须显式声明会与第 1 类叠加冲突的属性（如 `.placing` 的 `display`/`overflow`、`.placing__right` 的 `flex-direction`、`.clock-board` 尺寸），不能依赖"上面的块不生效"的假设。

落地时先在 `667×375` 与 `844×390` 两个视口核对级联结果，再补其余宽度。

## 5. 出牌页修复

### 5.1 竖屏布局

保留现有顺序“回合状态 + 转盘 → 回合信息条 → 自己头像与手牌”，但改为自然高度的纵向内容：

```css
@media (max-width: 767px) and (orientation: portrait) {
  .placing {
    flex-direction: column;
    overflow: visible;
  }

  .placing__center {
    order: 1;
    flex: none;
    min-height: auto;
    padding: 12px 16px 16px;
    gap: 12px;
    overflow: visible;
  }

  .placing__turn-badge {
    position: relative;
    z-index: 4;
    flex-shrink: 0;
    max-width: calc(100vw - 32px);
    text-align: center;
  }

  .placing__center .clock-board {
    flex: none;
    width: min(78vw, 280px);
    max-width: none;
    margin-block: 18px;
  }
}
```

要点：

- `margin-block` 是为转盘外围徽标预留真实视觉空间，不能只靠 `z-index`。
- 回合状态条必须始终位于普通文档流，不能改成悬浮或绝对定位。
- 回合信息条和手牌区沿用现有顺序，但不再要求都塞进首屏；底部手牌区保留 `padding-bottom: calc(... + env(safe-area-inset-bottom))`。
- 页面任意位置纵向滑动都应能驱动 `.room-view__main`；交互按钮仅使用 `touch-action: manipulation`，不要在转盘容器上设置 `touch-action: none`。

### 5.2 短横屏布局

新增专门的“短横屏”断点，不让 `844×390` 一类视口落入桌面三栏：

```css
@media (orientation: landscape) and (max-height: 600px) {
  /* 横屏手机专用布局 */
}
```

**已知取舍**：该断点不含宽度上限，桌面浏览器窗口被拖矮（如 `1440×550`）时也会进入手机横屏布局。这是有意为之——按可用高度而非设备类型适配，矮窗口下双区 + 可滚动的表现也优于被压扁的桌面三栏；不为此维护设备白名单或加 `pointer` 条件。若实测发现宽桌面矮窗口下 grid 列宽失衡，再评估补 `max-width` 上限，首轮不加。

建议使用双区布局：左侧为回合状态 + 转盘，右侧为手牌 + 回合信息；整页仍允许纵向滚动。可通过现有三个一级节点分配 grid area，无需复制数据或新增一套页面：

```css
.placing {
  display: grid;
  grid-template-columns: minmax(280px, 1.05fr) minmax(300px, .95fr);
  grid-template-areas:
    "clock hand"
    "clock status";
  align-items: start;
  overflow: visible;
}

.placing__center { grid-area: clock; }
.placing__left   { grid-area: hand; width: auto; }
.placing__right  { grid-area: status; width: auto; flex-direction: row; }
.placing__left .rules-panel { display: none; }
.placing__center .clock-board {
  width: clamp(240px, 38vw, 320px);
  flex: none;
}
```

最终列宽需在 667、740、812、844、852 CSS px 的横屏宽度上实测。若宽度不足以稳定容纳双区，则回退为与竖屏相同的单列自然流；“能滚动且不重叠”优先于强行双栏。

### 5.3 HintPrompt 弹窗必须随本次滚动模型一起改

`.hint-prompt-backdrop` 目前是 `position: absolute; inset: 0`，锚定在 `position: relative` 的 `.placing` 上。旧布局里 `.placing` 恰好占满可视区，弹窗居中即视口居中；本方案改为“内容自然高度 + 页面滚动”后，`.placing` 会高于视口，遮罩内的 `align-items: center` 会把“决定是否使用提示标记”弹窗定位到**长容器的几何中部**——用户当前滚动位置可能完全看不到它，而该弹窗带倒计时，是强交互路径，不能靠用户自己滚过去找。

修复要求：

- `.hint-prompt-backdrop` 改为 `position: fixed; inset: 0`（配合 `100dvh` 语境即视口定位；若遇层叠上下文干扰则将 HintPrompt portal 到 `body`）；
- 遮罩必须盖满整个视口并阻断下层滚动（遮罩自身 `overscroll-behavior: contain`），弹窗在视口内居中；
- 弹窗底部按钮避开 `safe-area-inset-bottom`；
- “竖屏与短横屏下，无论 `.room-view__main` 滚动到任何位置，弹窗完整可见”加入 §9 测试与 §10 验收矩阵。

## 6. 讨论页修复

### 6.1 等待提示使用专用状态样式

修改 [Discussion.tsx](../client/src/views/Discussion.tsx)：

- 将“等待房主或倒计时结束…”和“正在恢复连接，操作暂停…”从 `.view-stub` 改为 `.discussion__status`；
- 两条状态可放入统一的 `.discussion__status-group`，避免重复占位；
- 状态容器使用 `role="status"`、`aria-live="polite"`；
- `.discussion__status` 不允许 `flex-grow`，只占文字实际高度。

建议样式：

```css
.discussion__status-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.discussion__status {
  margin: 0;
  color: var(--ink-mut);
  font-size: 13px;
  line-height: 1.4;
  text-align: center;
}
```

这样等待提示会稳定排在转盘下方，不会覆盖转盘，也不会把底部条件栏推出可达区域。

### 6.2 竖屏改为纵向内容流

当前讨论页在手机竖屏仍维持“左转盘 + 右聊天”双栏，正是截图中转盘被缩到左上角、聊天占据右半屏的原因。竖屏应改为：转盘与等待/开始状态 → 聊天 → 本关条件。

```css
@media (max-width: 767px) and (orientation: portrait) {
  .discussion__main {
    flex: 0 0 auto;
    flex-direction: column;
    min-height: auto;
    overflow: visible;
  }

  .discussion__clock-col {
    flex: none;
    width: 100%;
    justify-content: flex-start;
    gap: 12px;
    padding: 16px;
    border-right: none;
    border-bottom: 1px solid var(--hairline);
  }

  .discussion__clock-col .clock-board {
    flex: none;
    width: min(78vw, 300px);
    margin-block: 16px;
  }

  .discussion__chat-col {
    flex: none;
    min-height: 260px;
    height: min(42dvh, 360px);
  }

  .discussion__conditions {
    padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  }
}
```

条件列表仍处于正常文档流；内容较长时由 `.room-view__main` 滚到下方查看，不设置 fixed/sticky 底栏去遮挡转盘。

### 6.3 横屏保持双栏，但改为高度安全且可滚动

横屏可保留左转盘、右聊天的结构，但主行不能继续被锁成“剩余高度”：

```css
@media (orientation: landscape) and (max-height: 600px) {
  .discussion__main {
    flex: 0 0 auto;
    min-height: 300px;
    overflow: visible;
  }

  .discussion__clock-col {
    flex: 1 1 52%;
    justify-content: flex-start;
    padding: 12px 16px;
  }

  .discussion__clock-col .clock-board {
    flex: none;
    width: clamp(240px, 38vw, 320px);
    margin-block: 12px;
  }

  .discussion__chat-col {
    flex: 1 1 48%;
    min-width: 280px;
    height: 320px;
  }
}
```

当“主行 + 底部条件”高于横屏可视高度时，`.room-view__main` 必须出现真实可操作的纵向滚动范围。禁止通过 `justify-content: center` 让超高内容产生不可恢复的顶部负溢出。

## 7. 横竖屏切换与 Safari 视口

### 7.1 viewport meta

将 [index.html](../client/index.html) 更新为：

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover"
/>
```

顶部栏继续使用 `safe-area-inset-top/left/right`；手牌区、讨论条件区和弹窗底部使用 `safe-area-inset-bottom`。

### 7.2 优先使用 CSS，不用旋转事件手工重载页面

- 使用 `dvh`、`orientation` 和 `max-height` 后，浏览器旋转时会自动重新计算布局；不应监听 `orientationchange` 后 `location.reload()`。
- 不保存转盘的像素宽高到 React state，避免旋转后残留旧尺寸。
- 不在旋转时重置房间状态、选中手牌或聊天输入。
- 若真机 Safari 仍出现旧 visual viewport 高度（需先复现并记录版本），再增加极小的 `visualViewport.resize` CSS 变量回退；该 JS 方案不是首轮实现项。

### 7.3 旋转后的滚动位置

旋转后浏览器可能保留旧 `scrollTop`。首轮不应强制把用户滚回顶部；只有当当前滚动位置超过新的最大范围、浏览器又未自动钳制时，才在 `.room-view__main` 上做边界钳制。不能使用全局 `window.scrollTo(0, 0)`，否则会打断出牌操作。

## 8. 实施文件与顺序

### P0：修复结构性裁切

1. [client/src/styles/global.css](../client/src/styles/global.css)
   - 建立 `.room-view__main` 单一页面滚动模型；
   - 按 §4.3 的三类清单拆分现有 `≤767px` 媒体块（双方向保留 / 迁入 portrait / 由 landscape 覆盖）；
   - 删除移动端 `.placing { overflow: hidden; }` 与 Reveal 的 `.reveal__main { overflow-y: auto }`（§4.1）；
   - `.hint-prompt-backdrop` 改为 `position: fixed`（§5.3）；
   - 为转盘外围内容预留 block margin；
   - 增加讨论页竖屏布局与 `orientation + max-height` 短横屏布局；
   - 确保所有阶段无横向页面滚动。
2. [client/src/views/Discussion.tsx](../client/src/views/Discussion.tsx)
   - 用 `.discussion__status` 替换等待态中的 `.view-stub`；
   - 补充状态语义。
3. [client/index.html](../client/index.html)
   - 增加 `viewport-fit=cover`。

### P1：重写移动端回归测试

4. [client/e2e/helpers.ts](../client/e2e/helpers.ts)
   - 按 §9.0 支持向 `browser.newContext()` 传入 viewport 等 context options。
5. [client/e2e/mobile-placing-layout.spec.ts](../client/e2e/mobile-placing-layout.spec.ts)
   - 改用 §9.0 的视口设置方式（现有 `test.use({ viewport })` 对手动 context 无效）；
   - 删除“placing locks a no-scroll layout”断言；
   - 改测回合状态条与转盘不相交、手牌可滚动到达、无横向溢出、弹窗可见性（§9.4）。
6. 新增 `client/e2e/mobile-discussion-orientation.spec.ts`
   - 覆盖讨论页等待提示、聊天、条件栏与横竖屏切换，以及 §9.5 的其余阶段冒烟回归。

### P2：真机微调

7. 根据 iPhone Safari 和 Android Chrome 实测微调转盘上限、横屏列宽和聊天区最小高度；只调整 CSS token/断点，不增加设备型号特判。

## 9. 自动化测试设计

### 9.0 先修正视口设置方式（前置项）

现有 [mobile-placing-layout.spec.ts](../client/e2e/mobile-placing-layout.spec.ts) 用 `test.use({ viewport: devices["iPhone 13"].viewport })` 设定视口，但被测页面来自 helpers 的 `browser.newContext()`（无参数创建）。`test.use` 的 viewport 只作用于 Playwright 内建 fixture，对手动创建的 context **无效**；`playwright.config.ts` 也没有全局 viewport。因此该 spec 实际很可能一直运行在默认 `1280×720` 下，其“移动端”断言并未在移动视口验证过。

实施要求：

- 动手改布局前先原样跑一次该 spec，记录其真实通过/失败状态，作为基线；
- 给 `setupTwoPlayersInPlacing` 等 helpers 增加可选的 context options 参数，把 viewport 传入 `browser.newContext()`；或在 setup 返回后对 `pageA`/`pageB` 显式调用 `setViewportSize()`；
- 所有移动端 spec 一律通过上述方式设定视口，删除对手动 context 无效的 `test.use({ viewport })` 写法。

### 9.1 出牌页竖屏

视口至少覆盖 `390×844` 和 `375×667`：

- `.placing__turn-badge` 可见；
- 回合状态条 bounding box 的底边小于等于转盘完整容器预留区的顶边，两者不相交；
- `.room-view__main` 的 `scrollTop` 可从 0 变为正数（内容不足一屏时可跳过该断言，但所有关键元素必须可见）；
- `hand-rail.scrollIntoView()` 后手牌完整可操作；
- `scrollWidth <= clientWidth + 1`，不存在横向页面滚动；
- 点击手牌再点击区段的核心交互仍通过。

### 9.2 讨论页竖屏等待态

- 接受规则说明后，转盘、`.discussion__status`、聊天区、条件列表按纵向顺序排列；
- 转盘与等待提示 bounding box 不相交；
- `.discussion__status` 的 computed `flex-grow` 为 `0`；
- 条件列表可通过页面纵向滚动到达；
- 聚焦聊天输入后，软键盘缩小 visual viewport 时页面仍可滚动到输入框（真机项，Playwright 桌面内核只做基础尺寸验证）。

### 9.3 同一页面旋转

不能只开两个不同 viewport 的页面，应在同一 page 上执行：

1. `page.setViewportSize({ width: 390, height: 844 })`；
2. 验证竖屏布局；
3. `page.setViewportSize({ width: 844, height: 390 })`；
4. 等待一次布局稳定（使用 `expect.poll`，不要固定 sleep）；
5. 验证进入短横屏规则、转盘未裁切、页面存在可用纵向滚动、条件栏可达；
6. 再切回 `390×844`，确认没有残留固定宽高或锁死滚动。

讨论页和出牌页都应执行该旋转回归。

### 9.4 HintPrompt 弹窗可见性（对应 §5.3）

- 竖屏 `390×844`：先把 `.room-view__main` 滚到底部，再触发提示决策弹窗，断言 `.hint-prompt` 的 bounding box 完全落在视口内；
- 短横屏 `844×390` 重复同一断言；
- 弹窗打开期间操作滚动，`.room-view__main.scrollTop` 不应变化（遮罩阻断下层滚动）。

### 9.5 其余阶段冒烟回归（对应 §4.1 全局改动）

Lobby、LevelSelect、Reveal、Result 在 `390×844` 与桌面 `1280×720` 各做一次：

- 页面无横向滚动、无嵌套双滚动条（Reveal 重点验证其内部滚动已收归 `.room-view__main`）；
- 关键交互元素（准备按钮、选关卡片、继续按钮）可见或可滚动到达。

### 9.6 防止假通过

- `toBeVisible()` 只说明 DOM 可见，不代表未被覆盖；必须增加 bounding box 不相交断言。
- “元素底边小于 viewport 高度”不再是移动端的通用成功条件；长内容允许位于首屏下方，但必须能滚动到达。
- 测试滚动时直接操作 `.room-view__main.scrollTop` 并检查变化，不能只调用 `window.scrollTo`，因为页面级滚动所有者不是 window。

## 10. 真机验收矩阵

| 场景 | 视口/设备 | 必验结果 |
| --- | --- | --- |
| 小屏竖屏 | iPhone SE 级别，约 `375×667` | 回合 tab 不被遮挡；手牌和条件可下滑到达 |
| 常规竖屏 | iPhone 13/14，约 `390×844` | 等待提示位于转盘下方；无大片异常空白 |
| 常规横屏 | 约 `844×390` | 自动进入短横屏布局；转盘完整且页面可上下滚动 |
| 横屏地址栏展开/收起 | iOS Safari | 高度随 visual viewport 更新，不锁死、不跳回登录页 |
| 竖→横→竖 | iOS Safari / Android Chrome | 转盘重新计算尺寸；滚动仍有效；手牌选择状态不异常 |
| 聊天键盘弹出 | 讨论页竖屏 | 输入框不被键盘永久遮挡，收起键盘后布局恢复 |
| 刘海与底部手势条 | iPhone 真机 | 顶栏、手牌、条件和操作按钮均避开安全区 |
| 提示决策弹窗 | 竖屏与横屏、任意滚动位置 | HintPrompt 完整可见、居中于视口，遮罩阻断下层滚动 |
| 其余阶段冒烟 | Lobby / LevelSelect / Reveal / Result | 单一滚动容器生效，无双滚动条、无横向滚动 |

## 11. 完成标准

- “轮到你出牌”状态条与转盘（含外围提示徽标）之间至少保留 8px 可视间距，任何目标手机视口下不相交。
- 讨论页“等待房主或倒计时结束”始终位于转盘之后的普通文档流，不覆盖、不拉伸占满整列。
- `390×844 → 844×390 → 390×844` 连续切换后，转盘、聊天、手牌和条件仍可加载并滚动到达。
- `.room-view__main` 是唯一页面级纵向滚动容器；移动端阶段根节点不存在裁切正常内容的 `overflow: hidden`，Reveal 不再自带页面级内部滚动。
- 提示决策弹窗（HintPrompt）在任何滚动位置、任何目标视口下完整可见。
- 所有目标视口无横向页面滚动，无需刷新页面恢复布局。
- 更新后的 Playwright 用例通过，桌面端现有布局与核心出牌/聊天交互无回归。

## 12. 非目标

- 不修改后端房间状态、计时器或 Socket.IO 事件。
- 不重做转盘视觉、不改变关卡条件徽标含义。
- 不为了适配横屏复制一套 React 页面或维护设备型号白名单。
- 不强求所有内容永远同时出现在首屏；本次目标是内容不重叠、不裁切，并且可稳定滚动到达。
