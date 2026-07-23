# Take Time 前端开发总入口与 UI 计划

> 状态：**前端开发唯一入口，持续维护**
>
> 适用范围：`client/` 页面、组件、状态、Socket 适配、样式、响应式、可访问性和前端 E2E
>
> 最后同步：2026-07-21
>
> 核心原则：**服务端是权威状态来源**；前端只渲染安全投影并发送意图，不自行判定胜负、回合合法性或隐藏牌值。

## 0. Agent 开发入口

任何 Agent 开始前端任务时，先读项目总索引 [AGENTS.md](../AGENTS.md)，再读本文。本文负责告诉 Agent：还需要参考哪些文件、它们在哪里、各自管什么，以及发生冲突时听谁的。

### 0.1 阅读顺序与权威优先级

1. [rules.md](../rules.md)：游戏机制、卡牌模型和胜负规则的最高权威。
2. [architecture.md](architecture.md)：当前前后端边界、2–4 人、Agent、会话、隐藏信息和持久化架构的最高权威。
3. [docs/adr/](adr/)：已经确认的重要架构决策；同一主题的新 ADR 可替代旧实现口径。
4. 当前功能的详细设计或执行计划，例如[邮箱身份与账号管理设计](../plans/2026-07-20-email-identity-recovery-and-admin-management-design.md)。
5. 本文：前端信息架构、设计语言、组件组织、代码导航和验收入口。
6. 可运行 Prototype：只作为视觉和交互参考，不能覆盖规则、架构或安全约束。
7. 历史 PRD/计划：只用于理解背景，不得覆盖以上现行文档。

发生冲突时按上述顺序处理，并在修改中同步更新被影响的现行文档。不要通过“选择更方便实现的那份”自行解决冲突。

### 0.2 前端必读文件索引

| 文件 | 位置 | 作用 | 何时必须阅读 |
| --- | --- | --- | --- |
| 项目总索引 | [AGENTS.md](../AGENTS.md) | 项目状态、权威文件、目录和全局约定 | 每次任务开始 |
| 游戏规则 | [rules.md](../rules.md) | 发牌、隐藏信息、阶段、条件和胜负口径 | 游戏界面、牌面、规则文案 |
| 当前架构 | [architecture.md](architecture.md) | 服务端权威、2–4 人、会话、Agent、Provider 和持久化边界 | 所有状态、Socket、账号和 Agent 任务 |
| 产品路线图 | [product-roadmap-prd.md](product-roadmap-prd.md) | V1–V4 产品范围和里程碑背景 | 新功能排期、范围判断 |
| 前端总入口 | [frontend-ui-plan.md](frontend-ui-plan.md) | 本文件；视觉、页面、组件、代码/测试导航 | 所有前端任务 |
| 后端总入口 | [backend-dev-plan.md](backend-dev-plan.md) | 后端模块、Socket 矩阵、账号与会话不变式、代码/测试导航 | 对接事件或状态；冲突时以架构为准 |
| Agent 记忆设计 | [agent-memory-system-design.md](agent-memory-system-design.md) | attempt、每座位策略、公开/私有记忆边界 | Agent 消息、策略摘要、复盘 UI |
| Agent 剩余计划 | [2026-07-18-agent-remaining-development-plan.md](../plans/2026-07-18-agent-remaining-development-plan.md) | M9.3–M9.6 当前执行顺序 | 新增 Agent 前端能力 |
| 账号现行设计 | [2026-07-20-email-identity-recovery-and-admin-management-design.md](../plans/2026-07-20-email-identity-recovery-and-admin-management-design.md) | 第一阶段未验证邮箱登录、直接注册、无找回限制和管理员维护 | 登录、账号、管理员页面 |
| 账号架构决策 | [ADR-0007](adr/0007-account-password-lifecycle-and-admin-management.md) | 邮箱身份、密码生命周期和管理员权限边界 | 账号字段、路由和管理动作 |
| 身份与接管决策 | [ADR-0005](adr/0005-player-identity-and-admin-seize.md) | 玩家会话、重连和管理员接管 | 登录恢复、请出、接管 |
| 账号/记忆决策 | [ADR-0006](adr/0006-player-accounts-and-deferred-agent-memory.md) | 当前昵称账号实现与长期记忆推迟背景 | 修改现有账号代码、做迁移 |
| 关卡索引 | [levels/README.md](../levels/README.md) | 条件类型、区段编号和关卡文件入口 | 规则说明、条件文案、选关页 |

### 0.3 历史文件与使用限制

| 文件 | 状态 | 使用限制 |
| --- | --- | --- |
| [take-time-web-prototype.md](take-time-web-prototype.md) | 历史双人 V1 基线 | 不代表当前 2–4 人、Agent 和账号架构 |
| [2026-07-17-player-accounts-and-profile-memory-plan.md](../plans/2026-07-17-player-accounts-and-profile-memory-plan.md) | 当前昵称账号实现的历史执行计划 | 用于理解现有代码，不覆盖 ADR-0007 的邮箱目标模型 |
| [2026-07-20-account-security-and-admin-management-design.md](../plans/2026-07-20-account-security-and-admin-management-design.md) | 已被替代 | 不再采用“恢复密钥为主、管理员签发重置凭证”的方案 |

### 0.4 功能到代码与测试的导航

| 功能 | 主要代码 | 状态/协议 | 关键测试或参考 |
| --- | --- | --- | --- |
| 应用入口与轻量路由 | [`client/src/main.tsx`](../client/src/main.tsx) | 玩家页、`/account/security`、`/admin/*`、Prototype 路由分流；管理路由不提交玩家凭证 | [`account-security.spec.ts`](../client/e2e/account-security.spec.ts) · [`email-account-prototype.spec.ts`](../client/e2e/email-account-prototype.spec.ts) |
| 房间视图编排 | [`RoomView.tsx`](../client/src/views/RoomView.tsx) · [`TopBar.tsx`](../client/src/components/TopBar.tsx) | 按服务端 phase 和会话状态切换页面；结束本局后保留座位回准备大厅 | [`state-sync.spec.ts`](../client/e2e/state-sync.spec.ts) · [`end-game-return-lobby.spec.ts`](../client/e2e/end-game-return-lobby.spec.ts) |
| 当前玩家登录/注册 | [`Login.tsx`](../client/src/views/Login.tsx) | 生产邮箱登录 + 显式注册双 Tab；真实 Socket、会话与入房 | [`accounts.spec.ts`](../client/e2e/accounts.spec.ts) |
| 邮箱账号 Prototype | [`EmailAccountPrototype.tsx`](../client/src/views/EmailAccountPrototype.tsx) · [`email-account-prototype.css`](../client/src/styles/email-account-prototype.css) | 简洁“登录 / 注册”双 Tab；未验证邮箱、无找回；纯前端 mock | [`email-account-prototype.spec.ts`](../client/e2e/email-account-prototype.spec.ts) |
| 账号与安全 | [`AccountSecurityPage.tsx`](../client/src/views/AccountSecurityPage.tsx) | 无座账号会话、改名/改密/换邮/撤销设备、加载失败态 | [`account-security.spec.ts`](../client/e2e/account-security.spec.ts) |
| 管理员 | [`AdminPage.tsx`](../client/src/views/AdminPage.tsx) | 生产后台登录、账号维护、接管与请出 | [`admin-seize.spec.ts`](../client/e2e/admin-seize.spec.ts) |
| 大厅与设置 | [`Lobby.tsx`](../client/src/views/Lobby.tsx) · [`PlayerSeat.tsx`](../client/src/components/PlayerSeat.tsx) · [`SettingsPanel.tsx`](../client/src/components/SettingsPanel.tsx) | 固定四座、2–4 人、房主与 Agent | [`lobby-sync-and-capacity.spec.ts`](../client/e2e/lobby-sync-and-capacity.spec.ts) |
| 选关 | [`LevelSelect.tsx`](../client/src/views/LevelSelect.tsx) | 服务端进度和房主操作 | [`levelselect-readonly-semantics.spec.ts`](../client/e2e/levelselect-readonly-semantics.spec.ts) |
| 讨论与聊天 | [`Discussion.tsx`](../client/src/views/Discussion.tsx) · [`Chat.tsx`](../client/src/components/Chat.tsx) | attempt 消息、Agent 公开消息、倒计时 | [`chat-input-name.spec.ts`](../client/e2e/chat-input-name.spec.ts) |
| 出牌 | [`Placing.tsx`](../client/src/views/Placing.tsx) · [`ClockBoard.tsx`](../client/src/components/ClockBoard.tsx) · [`HandRail.tsx`](../client/src/components/HandRail.tsx) | 手牌安全投影、自由放置、提示窗口 | [`segment-placement.spec.ts`](../client/e2e/segment-placement.spec.ts) · [`hidden-card-leak.spec.ts`](../client/e2e/hidden-card-leak.spec.ts) |
| 揭示与结算 | [`Reveal.tsx`](../client/src/views/Reveal.tsx) · [`Result.tsx`](../client/src/views/Result.tsx) | 只展示服务端校验结果 | [`result-timeout-render.spec.ts`](../client/e2e/result-timeout-render.spec.ts) |
| 重连与会话 | [`socket/client.ts`](../client/src/socket/client.ts) · [`lib/session.ts`](../client/src/lib/session.ts) | 账号/座位双 handshake auth、分离的 sessionStorage、凭证轮换 | [`reconnect.spec.ts`](../client/e2e/reconnect.spec.ts) · [`account-security.spec.ts`](../client/e2e/account-security.spec.ts) |
| 全局状态 | [`useRoomStore.ts`](../client/src/store/useRoomStore.ts) · [`selectors.ts`](../client/src/store/selectors.ts) | 公共状态、私有手牌、派生权限 | [`multiplayer-complete-flow.spec.ts`](../client/e2e/multiplayer-complete-flow.spec.ts) |
| Socket 动作适配 | [`socket/adapter.ts`](../client/src/socket/adapter.ts) | UI 意图到共享事件的薄封装 | 事件类型以 [`shared/src/events.ts`](../shared/src/events.ts) 为准 |
| 样式与 Token | [`tokens.css`](../client/src/styles/tokens.css) · [`global.css`](../client/src/styles/global.css) | 生产 UI 的主题、布局和响应式 | [`mobile-placing-layout.spec.ts`](../client/e2e/mobile-placing-layout.spec.ts) · [`skip-link.spec.ts`](../client/e2e/skip-link.spec.ts) |

### 0.5 开发前检查清单

1. 先判断任务属于“现行生产页面”还是“仅 Prototype”；未经明确实施请求，不把 mock 行为接入真实账号库。
2. 查上表找到对应规则、架构、详细设计、代码和测试；不要只读 Prototype 截图。
3. Socket 事件和 payload 只从 `@take-time/shared` 导入，前端不维护第二套协议类型。
4. 隐藏牌值、管理员凭证、邮箱、令牌和模型私有记忆不得进入公共 store、DOM、URL 或日志。
5. 保存前验证桌面和移动端；按风险运行 typecheck、相关 Playwright E2E 和 production build。
6. 新增新的权威文档、页面入口或核心测试时，同步更新本节索引。

### 0.6 当前实现与目标设计的边界

- 游戏主流程、固定四座、2–4 人和多人 UI 已落地。
- 当前生产 [`Login.tsx`](../client/src/views/Login.tsx) 已在 `/` 与 `/account/register` 提供邮箱登录和显式注册，并接入真实 Socket、账号持久化、账号/座位会话和入房流程。
- [`AccountSecurityPage.tsx`](../client/src/views/AccountSecurityPage.tsx) 与 [`AdminPage.tsx`](../client/src/views/AdminPage.tsx) 已生产化；账号会话不依赖占座，资料加载具有失效/超时错误态。第一阶段不接邮件 Provider，也不提供找回。
- Prototype 路由以 `/prototype/` 开头，不建立 Socket 连接，不得被当作已经完成的生产功能。
- 后续修改账号资料和管理员页面时，以账号详细设计和 ADR-0007 为准；不得复制 Prototype 的本地 mock 状态。

---

## 1. 美术方向：午夜天文台 / 黄铜机械

深夜里，玩家们围绕一具黄铜天文钟共同解谜。沉静、专注、带计时压迫感——契合「先讨论、看牌后禁沟通、轮流暗置、倒计时压顶」的核心张力。钟面是黄铜刻度环，暗牌是磨砂铜片，唯一翻开的提示牌像被点亮的宝石。

### 1.1 设计语言关键词
机械精密 · 暗夜留白 · 黄铜与琥珀 · 低饱和高对比 · 克制的发光。

### 1.2 设计 Token（CSS 变量，定义在 `:root`，深色主题）

```css
:root {
  color-scheme: dark;            /* 指南要求：深色主题显式声明 */

  /* —— 背景 / 层次 —— */
  --bg-0:   #060a12;             /* 最底层 */
  --bg-1:   #0c1320;             /* 主背景，配合径向渐变营造氛围 */
  --bg-2:   #121b2c;             /* 卡片 / 面板 */
  --bg-3:   #1a2740;             /* 浮层 / 悬浮态 */
  --hairline:#2a3550;            /* 1px 描边 / 分隔 */

  /* —— 文字 —— */
  --ink:    #ECE6D8;             /* 暖白主文字 */
  --ink-mut:#9AA4B8;             /* 次要文字 */
  --ink-dim:#5C6680;            /* 禁用 / 占位 */

  /* —— 黄铜 / 琥珀 强调 —— */
  --brass:  #C9A24B;            /* 主强调：刻度、边框、品牌 */
  --amber:  #E8B14C;            /* 高亮：提示牌、激活刻度 */
  --brass-glow: rgba(232,177,76,.35);

  /* —— 功能色 —— */
  --turn:   #4FD1C5;            /* 「轮到你」青色高光 */
  --turn-glow: rgba(79,209,197,.30);
  --danger: #E0533D;            /* 超时 / 失败 / 判负 */
  --success:#7FB069;            /* 通关 / 条件达成 */
  --warn:   #E8B14C;            /* 倒计时进入危险区 */

  /* —— 字体 —— */
  --font-display: "Fraunces", "Songti SC", serif;       /* 标题：光学衬线，有性格 */
  --font-body:    "Spline Sans", "PingFang SC", system-ui, sans-serif;
  --font-mono:    "Geist Mono", "JetBrains Mono", ui-monospace, monospace; /* 计时器 / 点数 / 关号 */

  /* —— 半径 / 阴影 / 动效 —— */
  --r-card: 14px;  --r-pill: 999px;
  --shadow-card: 0 8px 28px rgba(0,0,0,.45);
  --shadow-lift: 0 14px 40px rgba(0,0,0,.55);
  --ease: cubic-bezier(.2,.7,.2,1);
  --dur-fast: 140ms; --dur: 240ms; --dur-slow: 420ms;
}
```

> 字体经 `<link rel="preload" as="font" font-display:swap>` 预加载（指南：关键字体预加载）。计时器、点数、关卡编号一律 `font-variant-numeric: tabular-nums`（指南：数字列等宽，倒计时不抖动）。

### 1.3 氛围层（背景 / 纹理）
- `--bg-1` 之上叠一层极淡径向渐变（钟心微光）+ 4% 不透明的噪点纹理 PNG/SVG，避免纯色平板。
- 卡片用 `--bg-2` + 1px `--hairline` 描边 + `--shadow-card`，悬浮态升到 `--bg-3` 并加极淡黄铜内描边。
- 黄铜元素用细微线性渐变（`#D9B25E → #A8842F`）模拟金属反光，不滥用发光——只有「提示牌」「轮到你」「危险倒计时」三处允许 glow。

### 1.4 动效原则（遵循指南）
- 只动 `transform` / `opacity`，禁止 `transition: all`，逐属性列出。
- 全程尊重 `prefers-reduced-motion`：发牌、翻牌、揭示统一降级为透明度淡入或瞬时切换。
- 高光时刻集中投放：① 进房落座、② 发牌（12 张铜片错位飞入，stagger）、③ 揭示（6 段依次翻牌 + 条件逐条亮灯）。其余用克制微交互。
- 动画可打断：倒计时切换、轮次交接不卡在动画里。

---

## 2. 信息架构与界面地图

认证与管理页面由 URL 分流；进入游戏后，房间界面**直接由服务端 `phase` 驱动**。顶层 `<RoomView>` 按会话和 `room:state.phase` 切换游戏视图，不自建一套与服务端竞争的阶段状态。

| 路由 / `phase` | 界面 | 关键内容 |
| --- | --- | --- |
| `/`（无玩家会话，目标设计） | **认证入口** | 简洁单卡片；“登录 / 注册”两个 Tab；邮箱 + 个人密码，房间密码单独验证准入 |
| `/account/register` | **注册** | 邮箱、密码、昵称、房间密码 → 直接创建账号并进入大厅；邮箱不验证 |
| `/account/security` | **账号与资料** | 上传、更换或恢复默认头像；修改昵称、密码和未验证登录邮箱；管理会话 |
| `/admin`、`/admin/accounts`、`/admin/room` | **管理员** | 管理认证、账号维护、房间请出与显式接管 |
| `waiting` | **大厅 / 准备** Lobby | 固定四座、2–4 人准备、房主设置面板、开始确认 |
| `levelSelect` | **选关** LevelSelect | 关卡网格、已通关标记、房主选关 |
| `discussion` | **讨论** Discussion | **进入时先弹「本关规则说明页」**（条件清单 + 卡牌图例）→ 钟面预览 + 常驻规则面板 + 聊天、讨论倒计时、房主提前开始 |
| `placing` | **出牌** Placing（核心局面） | 三栏布局（左规则+手牌 / 中放大钟面 / 右状态）、回合倒计时、提示弹窗、提示标记余额 |
| `reveal` | **揭示** Reveal | 翻牌动画、各段总和、条件逐条校验 |
| `result` | **结算** Result | 成功/失败、复盘、下一关/重试/返回选关 |

全程常驻 **顶部状态条 `<TopBar>`**：品牌（`◷ TAKE TIME`）、当前关号、阶段名、**按座位数渲染的玩家状态点**（`seats[]` 派生；Agent 座位带标记）、（局中）提示标记余额、连接状态。回合指示泛化为「N 人中轮到谁」（局中高亮当前 `turn` 座位）。“结束游戏”二次确认明确写为“结束本局并返回准备房间”，确认后等待服务端 `waiting` 状态，不清本地座位会话。

### 2.1 URL / 深链

- 认证、账号与管理员页面使用明确路由：`/`、`/account/register`、`/account/security`、`/admin/*`。
- “登录 / 注册”共用一个视觉壳层，浏览器地址仍应反映当前 Tab，允许刷新、后退和直接访问。
- 游戏是单房间，进入大厅后**不把 phase 写进 URL**；刷新由玩家会话和最新 `room:state` 重建。
- 玩家邮箱、昵称、会话 token 和任何凭证均不得写入普通 URL；第一阶段不存在验证或重置 token。
- `/prototype/*` 仅用于评审，不属于生产导航，也不建立 Socket 连接。

### 2.2 连接 / 重连 / 离线态（TopBar 连接指示 + 全局行为）

连接状态是独立于 `phase` 的一条横切轴，TopBar 连接点至少表达三态，并驱动全局可交互性：

| 连接态 | TopBar 表现 | 全局行为 |
| --- | --- | --- |
| `connecting` | 黄铜脉冲点 +「连接中…」 | 登录前；动作按钮 spinner，不可重复提交 |
| `connected` | 稳定绿点 | 正常按 `phase` 渲染 |
| `reconnecting` | `--warn` 脉冲 +「正在恢复座位…」 | **禁用出牌 / 设置 / 房主操作**，棋盘半透明只读，倒计时停在最后已知值 |
| `disconnected` | `--danger` +「连接已断开」 | 超过后端保留期（[§3.1 `SEAT_HOLD_MS` 60s](backend-dev-plan.md)）仍未恢复 → 回登录页并提示重新进房 |

- 重连依赖 `socket/client.ts` 自动重连；handshake `auth` 分别提交账号资料会话与玩家座位会话（`lib/session.ts` 分开存入 `sessionStorage`）。账号会话可在无座时恢复资料，座位会话恢复游戏身份；恢复游戏后仍以服务端 `room:state` 为准（含 host 身份）。
- 断线期间**不本地推进任何状态**（计时、回合、结果均等服务端回包）；这与「服务端权威」一致。

---

## 3. 核心界面 UI 规划

> 以下 ASCII 仅示意布局骨架，非像素稿；其中双人文案只是布局示例，真实界面必须由 `seats[]` 和 `dealRules` 驱动并支持 2–4 人。桌面优先，同时提供窄屏降级。

### 3.1 认证入口：登录 / 注册

两页共用一个居中的简洁认证卡片，通过 Tab 和 URL 切换：

```text
        TAKE TIME

   ┌──────────────────────────┐
   │       登录       │      注册       │
   ├──────────────────────────┤
   │  当前页面标题             │
   │  必要字段                 │
   │  [ 主要操作按钮 ]         │
   └──────────────────────────┘
```

- 登录：邮箱、个人密码、房间密码。
- 注册：邮箱、个人密码、确认密码、游戏昵称、房间密码；提交后直接创建账号，不发送验证码。
- 两个 Tab 分别使用 `/`、`/account/register`，可以刷新、后退和直接访问。
- 昵称只在注册和账号资料中出现，不是登录凭证。
- 邮箱只作为未验证登录标识；卡片显示“当前不验证邮箱，也不支持找回密码，请妥善保管个人密码”。不渲染灰色找回入口。
- 认证页强调**简洁**：不放大幅时钟、左右分栏、宣传标语、身份模型说明或旧账号升级入口。
- 桌面卡片宽约 480–620px；移动端单列占满安全宽度。Prototype 见 [`EmailAccountPrototype.tsx`](../client/src/views/EmailAccountPrototype.tsx)。

### 3.2 大厅 / 准备 Lobby（`waiting`）
```
┌ TopBar ───────────────────────────────────────────────┐
│ ◷ TAKE TIME        待机中        ●A ●B ○C ○D           │
└────────────────────────────────────────────────────────┘
   ┌── 座位 A ──────┐        ┌── 座位 B ──────┐
   │  昵称           │        │   等待加入…     │
   │  ⌂ 房主         │        │                 │
   │  [ 已准备 ✓ ]   │        │  [ 准备 ]       │
   └────────────────┘        └────────────────┘

   ┌── 设置（仅房主可改，非房主只读）─────────────┐
   │ 讨论时间   ( 5 ) 10  15  20  分钟              │  ← 分段单选 pill
   │ 思考时间   10  15  ( 20 )  25  30  秒          │
   │ 提示标记    2  ( 3 )  4   个（全队共用）        │
   └────────────────────────────────────────────────┘

   已就位座位全部准备且人数合法 → 房主端浮出 [ 开始游戏 ]（非房主无此按钮）
```
- **座位区固定按 `seats[]` 渲染 A–D 四个座位**；`capacity` 恒为 4，只表示房间上限。准备态 / 房主徽标 / 昵称按座位 id 取，空座位显示「等待加入…」。
- **房主徽标** `⌂`：第一个准备者出现房主标记（依据 `host`）。
- **Agent 座位**：座位 `kind==='agent'` 时显示 Agent 徽标和名称，无真人“准备”交互；可用状态和房主添加/移除入口以服务端投影为准。
- 设置控件：非房主渲染为 `disabled` + `aria-disabled`，并提示「仅房主可调整」。
- 设置面板不再提供人数选择；显示“2–4 人弹性开局”的只读说明。房主可在空座添加/移除 Agent。
- 「开始游戏」按钮仅在 **就位人数为 2–4、至少 1 名真人、所有真人 ready 且我是房主** 时启用；Agent 自动就绪。
- 第 5 个真人进入时提示「房间已满」。

### 3.3 选关 LevelSelect（`levelSelect`）
```
┌ TopBar ───────────────  选择关卡  ──────────────────────┐
   已通关 12 / 40                       图例: ✓已通关 ◐当前
   ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐
   │1✓││2✓││3✓││4✓││5✓││6 ││7 ││8 │ …  ← 关卡卡片网格
   └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘
   每张卡：关号(mono) · 难度★ · 一句话条件 · 通关✓徽标
   房主点选 → host:selectLevel → 进入该关讨论
   非房主：卡片只读，提示「等待房主选关」
```
- 已通关来自 `progress.clearedLevels`，铜色 ✓ 印章质感。
- 关卡卡片是 `<button>`（房主）/ 非交互 `<div>`（非房主），不是 `<div onClick>`。
- 50+ 关时网格用 `content-visibility:auto` 兜底性能。

### 3.4 讨论 Discussion（`discussion`）

**进入讨论先弹「本关规则说明页」**（`<LevelRulesIntro>`，每关开始前必出）——这是玩家了解本关约束的统一入口：

```
   ┌──────────── 本关规则 · 第3关 ★ ─────────────┐
   │  ① 第 1 张打出的牌必须落入  区段 3              │
   │  ② 第 2 张打出的牌必须落入  区段 2              │
   │  ⚫⚪ 区段 4 恰好 1 黑 + 1 白（共 2 张）          │
   │ ───────────────────────────────────────────── │
   │  卡牌图例：                                     │
   │   ▣ 白牌(米白+深字)  ▣ 黑牌(深黑+亮字)          │
   │   ⬚ 手牌盲牌(?)  ▦ 桌面暗置  ◆ 提示翻开(发光)   │
   │  牌库 24 张：白 1–12 + 黑 1–12，每局发 12 张     │
   │           [ 已了解，开始讨论 → ]                │
   └─────────────────────────────────────────────────┘
```
- 规则文字由 `conditions` 经 `conditionText.ts` 渲染（见 §4.3）；卡牌图例为静态说明组件。
- 这是「卡牌图例」唯一集中展示处，**出牌页不再重复图例**（出牌页左侧只放精简规则文字面板）。
- 关闭后进入讨论主界面；讨论与出牌阶段左侧**常驻精简规则面板**供随时对照。

```
┌ TopBar ─ 第6关 · 讨论中 ─────────── ⏱ 04:37 (tabular) ──┐
┌───────────── 钟面预览 ──────────┐  ┌── 聊天 ───────────┐
│        12刻度黄铜环              │  │ A: 区6 放小的      │
│     6 个区段 S1…S6 高亮          │  │ B: 标记留给区2     │
│   （讨论阶段不发牌，看不到手牌） │  │ …                  │
│                                  │  │ [输入…] [发送]     │
└──────────────────────────────────┘  └────────────────────┘
┌── 本关目标（条件清单）──────────────────────────────────┐
│ • 区2 总和 12–16   • 区6 恰好 3 张   • 所有区段≥1 张 …    │
└──────────────────────────────────────────────────────────┘
   房主: [ 提前开始出牌 ]   非房主: 「等待房主或倒计时结束」
```
- **钟面中心显示时钟中心值 `centerCap`**：数字（`null`/省略按 24）或 `∞`（仅 `centerCap==="inf"`）。它表示「每个区段总和的上限」，是关卡级属性，讨论/出牌/揭示三处钟面都常驻显示，供玩家约定策略。
- 讨论倒计时 `timer:sync` 驱动，`aria-live="polite"`，进入最后 30s 转 `--warn`。
- 聊天遵循 UGC 处理：长文本 `break-words`、flex child `min-w-0`、空状态文案。
- **聊天消息结构化**：`Message` 增加 `attemptId`，按座位归属显示发送者，`kind==='agent'` 使用 Agent 样式。前端只展示当前 attempt 的消息；每个 Agent 的公开策略摘要由服务端 `AgentStrategyPlanner` 生成，前端不直接调用模型，也不展示私人计划。
- 条件清单把 `conditions` 渲染成人话（条件→中文映射表，见 §4.3）。

### 3.5 出牌 Placing（核心局面）

桌面**三栏**：左 = 规则面板 + 我的手牌（两行）｜ 中 = **放大居中的时钟盘**（约 460px，几乎占满中栏）｜ 右 = 紧凑状态栏（倒计时 / 提示标记 / 对手）。

```
┌ TopBar ── ◷ TAKE TIME ── 第3关 · 出牌 ── 提示标记 ◆◆◇ 2/3 ── ⏱ 0:05 ─┐
┌── 左栏(约210) ──┐  ┌──────── 时钟盘(460,居中放大) ────────┐  ┌右栏(约155)┐
│ 本关规则        │  │              S1                       │  │ 回合倒计时 │
│ ① 第1张→区3     │  │         ╱  S6      S2  ╲              │  │   0:05    │
│ ② 第2张→区2     │  │       │      ( ∞ 中心值 )    │        │  │ 已出      │
│ ⚫⚪ 区4各一     │  │         ╲  S5      S3  ╱              │  │ 你4·对方3 │
│ ─────────────   │  │              S4                       │  │ 还剩5张   │
│ 我的手牌        │  │  每段内：暗置铜片 / 明置数字牌(堆叠)  │  │ ───────── │
│ ┌1–3张────┐    │  │  每段下方：「N 张」计数(事实信息)     │  │ 提示标记  │
│ │ ? [7] [3]│    │  │  无任何合法/非法高亮区分             │  │ ◆◆◇ 2/3 │
│ ├4–6张────┤    │  └───────────────────────────────────────┘  │ ───────── │
│ │[11][9] ? │    │            ◉ 轮到你出牌                       │ 对手 Alice│
│ └──────────┘    │   选中手牌(升起高亮) → 点任一区段 → card:place│ 等待中…   │
└─────────────────┘                                              └───────────┘

提示决策弹窗（出牌后，全队暂停 5s）：
   ┌─────────────────────────────┐
   │  翻开这张牌示意队友？        │
   │  剩余标记 ◆◆◇               │
   │  [ 翻开 (Yes) ]  [ 不翻 (No)]│   ⏱ 自动倒数 5…4…3
   └─────────────────────────────┘
```

**核心交互决策：自由放置（系统不作合法性提示）**
- **任何区段都能放**：选中手牌后 6 个区段一律**等亮可点**（同一种青色），系统**不区分**「此处放合法 / 违规」，不高亮「正确区段」。所有条件约束由玩家自己对照左侧规则面板把握。
- **不在出牌阶段做任何条件反馈**：时钟盘上**不显示**条件 badge（如「① 第1张」「⚫⚪ 各一」），**不显示**「条件已达成 ✓」。所有校验**统一推迟到揭示阶段**逐条亮灯（§3.6）。
- 玩家可以把牌放到任意（甚至明显导致失败的）区段，乃至 12 张全堆一段——**规则允许，结果必然失败**，系统不阻止、不警告。

卡牌与可见性如实反映规则（全部由服务端遮蔽后下发，前端不解密）：

| 规则 | UI 表现 |
| --- | --- |
| 卡牌外形 | **长方形**牌（非圆形）：白牌米白渐变 + 深色数字，黑牌深黑渐变 + 亮色数字，数字用 `tabular-nums` |
| 手牌中间 4 张可见、两端 2 张盲 | 盲牌渲染为铜框磨砂片显示 `?`（无点数），可见牌正面数字 |
| 打满 2 张后剩余盲牌对己翻开 | `player:hand` 下发翻开值后，盲牌翻面动画 → 显示数字（仅本人） |
| 桌上暗置牌 | 区段内暗置牌 = 黑/白牌背（无数字）；**每段恒显「N 张」计数** |
| 提示翻开的牌永久正面 | 该牌渲染为黄铜发光边框的明置牌，双方可见数字 |
| **区段内多张牌堆叠** | **方案 C 紧凑行列**：每张牌缩小但完整独立，多张自动换行（最多两行 3 列），数字无遮挡；暗置/明置牌混排；**不显示**明置点数合计 |
| 抢先手 | 第一手两侧手牌都可出；首个 `card:place` 生效，另一侧即时锁定灰显 |
| 严格交替 | 仅「轮到我」时手牌可点/可拖、区段可点；否则禁用并显示「等待对方」 |
| 回合倒计时 | mono 大字，最后 2s 转 `--danger` 并脉冲；归零=判负 |
| 提示窗口暂停 | 期间棋盘整体 `inert`/半透明，只有弹窗可交互；超时=No，不判负 |

- **手牌两行布局**：HandRail 用 3×3 网格分两行渲染 6 张牌（第 1–3 张 / 第 4–6 张），每张用 `aspect-ratio:2/3` 撑满格位；不再单行平铺。盲/可见牌位由后端 dealRules 掩码决定（见下）。
- **手牌可见性由后端 dealRules 驱动，不写死「端 2 张盲」**：HandRail 按 `player:hand` 下发的可见性掩码渲染盲/可见牌位，不假设 2 人布局——2 人 = 中 4 可见、端 2 盲 + 双方都各自累计打出 2 张后分别翻盲；3/4 人 = 全可见、无盲牌、无翻盲（对齐后端 [§2.9 dealRules](backend-dev-plan.md)）。上方表格的「中 4 / 端 2」是 2 人 MVP 具体表现。
- 出牌交互：**点选手牌 → 点目标区段**（主交互，移动端友好）；桌面**额外**支持拖拽到区段（拖拽时禁选中文本、`touch-action:manipulation`），两者发同一个 `card:place`，后端无感知区别。每张 `HandCard` 带稳定 `cardId`，出牌发 `card:place { cardId, segment }`——**不用数组下标**，规避重连 / 回包延迟 / 手牌数组变化导致的错位（与后端 [§2.1 稳定 cardId](backend-dev-plan.md) 对齐）。
- **防误触（规则不可撤回，误触成本高）**：未选中手牌时区段**不可点**；选中一张后 6 个区段才高亮可点（等亮，不区分合法性）；发出 `card:place` 后立即进入 **pending 态**（手牌与区段全部禁点、显示「已发送…」），仅在收到 `room:state` 确认或 `room:error` 拒绝后解除——服务端拒绝时解除 pending 并 toast，**绝不本地撤销或重发**。点空白处 / 按 Esc 取消选中，不发送。
- 乐观更新策略：出牌后**不**本地猜测结果，按 `room:state` 回包为准（服务端权威、防抢手并发误判）；pending 仅是「已发送、等待确认」的轻态，不预判落子成败。
- **提示弹窗焦点管理**：弹窗打开时焦点落在默认安全项「不翻」（或倒计时文本），**Esc 不关闭**（避免误触提前决议），Tab 焦点锁在弹窗内（focus trap），背景棋盘 `inert`；倒计时归零后**由服务端状态关闭**（超时按 No），前端不自行关窗。
- **Agent 座位**：轮到 `kind==='agent'` 座位时，右栏显示「（Agent 名）思考中…」，不渲染真人手牌交互；Agent 落子由服务端注入，前端只随 `room:state` 更新。回合归属按 `turn` 座位 id，对 2–4 人通用。

### 3.6 揭示 Reveal（`reveal`）
```
   翻牌动画：6 段依次把暗铜片翻成正面（stagger ~120ms/段）
   ┌── 各段总和 ─────────────────────────────┐
   │ S1:8  S2:14  S3:6  S4:11  S5:9  S6:7      │  ← mono 等宽
   └──────────────────────────────────────────┘
   ┌── 条件校验（逐条亮灯）───────────────────┐
   │ ✓ 区2 总和 12–16   →  14  通过            │
   │ ✗ 区6 恰好 3 张    →  4 张  未达成        │  ← 失败项红色高亮
   │ ✓ 所有区段≥1 张                           │
   └──────────────────────────────────────────┘
```
- 数据来自 `revealResult.segmentSums` 与 `conditions[].pass`，前端**只展示**不判定。
- **揭示是条件校验的唯一反馈点**：出牌阶段刻意不给任何「合法/达成」提示（见 §3.5 自由放置），所有条件结果在此一次性逐条亮灯——成败悬念集中于此。
- 揭示是「过程展示」，结束自动落到 `result`。

### 3.7 结算 Result（`result`）
```
   成功:  ✦ 通关 ✦   第6关已记入进度（持久化）
          房主: [ 进入第7关 ]  [ 返回选关 ]
   失败:  ✕ 挑战失败   原因: 区6 牌数超限 / 超时判负
          复盘提示（失败项 + failureReason）
          房主: [ 重试本关 ]  [ 返回选关 ]
   非房主: 只读结果 + 「等待房主决定」
```
- 成功/失败用 `--success` / `--danger` 主色面板，配钟面定格快照。
- 房主专属操作按钮（`game:next` / `game:retry` / `host:backToLevelSelect`）仅房主渲染；服务端二次校验。

---

## 4. 组件清单与前端架构

### 4.1 技术栈与目录结构（Vite + React + TS）
```
client/src/
  main.tsx                 # 应用入口；真实玩家、/admin、/prototype/* 轻量分流
  socket/
    client.ts               # 单例 socket.io-client，连接/重连/恢复座位
    adapter.ts              # UI 动作 ↔ Socket 事件的薄适配层
  store/
    useRoomStore.ts         # room:state / player:hand / timers / 会话投影
    selectors.ts            # mySeat、isHost、canStart、isMyTurn、hintLeft…
  views/
    RoomView.tsx            # 按会话与 phase 编排真实游戏视图
    Login.tsx               # 生产邮箱登录/注册；真实 Socket 与会话接入
    Lobby.tsx  LevelSelect.tsx  Discussion.tsx
    Placing.tsx  Reveal.tsx  Result.tsx
    AdminPage.tsx           # 当前管理员认证、接管与请出
    EmailAccountPrototype.tsx # 邮箱认证/账号/管理员纯前端 Prototype
  components/
    TopBar.tsx  ClockBoard.tsx  ClockSegment.tsx
    HandCard.tsx  HandRail.tsx  CountdownTimer.tsx
    HintPrompt.tsx  PlayerSeat.tsx  SettingsPanel.tsx
    LevelRulesIntro.tsx  RulesPanel.tsx  ConditionList.tsx
    Chat.tsx  Avatar.tsx  Pill.tsx  Button.tsx  KickedNotice.tsx
  lib/
    session.ts              # sessionStorage 玩家会话
    avatar.ts               # 头像校验与本地保存
    conditionText.ts        # Condition → 中文文案
    segmentHints.ts         # 区段提示纯展示工具
    timeFmt.ts              # 时间格式化
  styles/
    tokens.css  global.css  email-account-prototype.css

client/e2e/                 # Playwright UI、同步、重连、泄漏和移动端验收
shared/src/                 # 前后端共享事件与状态类型；前端不得复制
```

> **类型单一来源（与后端 [backend-dev-plan §1](backend-dev-plan.md) 对齐）**：所有 socket 事件名、收发 payload、`room:state` / `player:hand` 等 state 类型都从 `@take-time/shared` import；前端**不维护第二套 events 类型**，杜绝前后端类型漂移。前端 `socket/` 只放 socket client 实例与 UI adapter。

> **座位模型与人数无关（与后端固定 4 座对齐）**：`useRoomStore` 的 `seats` / `ready` / `hands` 按座位 id 派生，不硬编码 `{A,B}`；`capacity` 恒为 4，实际人数由 occupied seats 决定。

### 4.2 状态管理与 Socket 映射
- **单一数据源**：`useRoomStore` 持有 `room:state`（公共）、`player:hand`（私有）、三个倒计时（`timer:sync`）。所有视图从派生 selector 读，不各自存副本。
- **收**：`room:state` / `player:hand` / `room:error` / `timer:sync` / `game:result` → 写入 store。
- **发**：UI 动作映射到客户端事件（与设计方案 §Socket 事件一一对应）：

| UI 动作 | 事件 |
| --- | --- |
| 未验证邮箱登录（现行实现） | `account:login { email, password, roomPassword }` |
| 未验证邮箱直接注册（现行实现） | `account:register { email, password, passwordConfirmation, nickname, roomPassword }` |
| 切换准备 | `player:ready` |
| 改设置（房主） | `settings:update` |
| 开始（房主） | `game:start` |
| 选关（房主） | `host:selectLevel { levelIndex }` |
| 提前开始出牌（房主） | `game:beginPlacement` |
| 发聊天 | `chat:send` |
| 出牌 | `card:place { cardId, segment }` |
| 提示决策 | `hint:decide { decision }` |
| 下一关/重试/返回（房主） | `game:next` / `game:retry` / `host:backToLevelSelect` |
| 结束本局并返回准备房间（任一在座玩家） | `game:end`；保留座位和玩家会话，以服务端 `waiting` 回包切回 Lobby |

- **倒计时**：以服务端 `timer:sync` 下发的 deadline 为准；`timer:sync` 是阶段/回合状态广播时的权威 deadline 同步，不是后端周期 tick。前端用 `requestAnimationFrame` 平滑插值显示剩余秒，但**判负由服务端宣布**（前端归零只做视觉，不发判负）。前端倒计时到 0 后只显示「等待结果…」，**不本地切到 result**，结果以 `room:state` / `game:result` 回包为准。（不做 NTP 式时钟偏移估算——每次状态同步携带新 deadline 已足够自校正。）
- **错误**：`room:error` → 顶层 toast，含下一步提示（指南：错误信息给修复方向）。

### 4.3 条件 → 中文文案映射（`conditionText.ts`）
与 [levels/README.md](../levels/README.md) 的条件词汇严格对齐，举例：
- `all-nonempty` → 「所有区段至少 1 张牌」
- `sum-range {2,12,16}` → 「区2 总和 12–16」
- `exact-cards {6,3}` → 「区6 恰好 3 张牌」
- `non-decreasing {1..6}` → 「区1 ≤ 区2 ≤ … ≤ 区6」
- `max-sum-each {24}` → 「每区段总和 ≤ 24」（时钟中心值；钟面中心另有大字展示，条件清单可省或并列）

新增条件类型时**同步更新此映射表**（与条件引擎词汇表保持一致）。这是 [levels/README.md · 扩展工作流](../levels/README.md) 的前端一环：新增 type = README 词汇 + `shared` Condition 联合 + 后端引擎 case + 求解器支持 + 前端文案/徽标映射。

---

## 5. Web Interface Guidelines 合规清单（前端落地必查）

- **倒计时 / 异步状态**：`aria-live="polite"`；计时器 `font-variant-numeric: tabular-nums` 防抖。
- **图标按钮**（房主徽标、提示标记、关闭）：`aria-label`；装饰性图标 `aria-hidden="true"`。
- **按钮 vs 链接**：动作用 `<button>`；不用 `<div onClick>`。
- **焦点态**：所有可交互元素 `:focus-visible` 可见环；不裸用 `outline:none`。
- **表单**：邮箱、密码、昵称和聊天输入均有 `<label>`/`name`/正确 `autocomplete`；密码框允许粘贴和密码管理器；请求中防重复提交并显示明确状态。
- **键盘**：手牌选择、区段放置、设置 pill 支持键盘操作（方向键 + Enter）。
- **动效**：尊重 `prefers-reduced-motion`；只动 `transform`/`opacity`；不用 `transition: all`；动画可打断。
- **触控**：交互元素 `touch-action: manipulation`；弹窗/抽屉 `overscroll-behavior: contain`；有意设置 `-webkit-tap-highlight-color`。
- **排版**：用 `…`（非 `...`）、弯引号；标题 `text-wrap: balance`；加载态以 `…` 结尾（「连接中…」「等待对方…」）。
- **内容溢出**：聊天/昵称 `break-words` + flex child `min-w-0`；处理空状态与超长 UGC。
- **深色主题**：`color-scheme: dark` + `<meta name="theme-color">` 匹配 `--bg-1`。
- **图片/字体**：图标用 inline SVG（无 CLS）；关键字体 `preload` + `font-display: swap`。
- **破坏性操作**：「重试本关」「返回选关」会丢弃当前局面，给二次确认。
- **文案**：动词开头、具体（「进入第7关」而非「继续」）；按钮 Title Case / 中文同等明确。

---

## 6. 响应式与降级
- **桌面优先**（玩家各自一屏看全局）。窄屏按自然文档流纵向排列，保留单一页面级滚动容器；不再要求把手牌固定成底部抽屉或把聊天/状态强制塞入 Tab。
- **移动端 placing 当前口径**：允许页面纵向滚动，保证钟面、状态条和手牌均可达；具体行为以当前 [`global.css`](../client/src/styles/global.css)、[`mobile-placing-layout.spec.ts`](../client/e2e/mobile-placing-layout.spec.ts) 和 [`mobile-discussion-orientation.spec.ts`](../client/e2e/mobile-discussion-orientation.spec.ts) 为准。
- 钟面用 SVG，随容器等比缩放（`viewBox`，不依赖 JS 测量）。
- 安全区：底部手牌抽屉用 `env(safe-area-inset-bottom)`。

---

## 7. 开发里程碑（前端）

### 7.1 游戏主流程历史里程碑

1. **M0 脚手架**：Vite+React+TS、tokens.css、字体接入、socket 单例、`useRoomStore` 骨架、`RoomView` 按 phase 切换（用 mock state 跑通 7 个空视图）。
2. **M1 当前昵称登录 + 大厅**：Login → `player:join`；Lobby 座位/准备/房主徽标/设置面板/开始确认；接 `room:state`。这是现行代码，不是邮箱目标模型。
3. **M2 选关 + 讨论**：LevelSelect 网格 + 已通关标记；**LevelRulesIntro 进关规则说明页（条件清单 + 卡牌图例）**；Discussion 钟面预览 + 常驻 RulesPanel + 聊天 + 讨论倒计时 + 房主提前开始。
4. **M3 出牌核心**：三栏布局 + 放大居中 ClockBoard（6 段，段内方案 C 堆叠 +「N 张」计数）+ HandRail 两行 3×3 可见性规则 + 抢先手/交替态 + 回合倒计时 + **自由放置交互（点选→点任一区段，无合法性提示）**。
5. **M4 提示系统**：HintMarkers 余额 + 出牌后 HintPrompt 5s 弹窗 + 暂停态 + 提示翻开牌展示。
6. **M5 揭示 + 结算**：Reveal 翻牌动画 + 各段总和 + 条件逐条亮灯；Result 成功/失败/复盘 + 房主按钮。
7. **M6 打磨**：动效（发牌/揭示 stagger）、reduced-motion、可访问性清单全过、响应式（含移动端 placing 可滚动布局）、连接/重连/离线三态、空/错/超长态、§8 Playwright E2E 场景全绿。

后续状态：M8 的固定 4 座、多人 selector、多人队友栏和 Agent 座位 UI 已落地；3/4 真人、脚本 Agent 混合完整 E2E 与 4 真人手机视口场景已通过。M9 前端已增加服务端白名单投影的公开 `SeatStrategy` 摘要、模型/安全降级来源和结算复盘；不展示 `privatePlan`、belief 或隐藏牌信息。

每个里程碑产出可与本地双开浏览器联调的可见界面，对齐设计方案 §测试计划。

### 7.2 第一阶段邮箱账号前端实施里程碑

1. **A1 认证壳层（已完成）**：生产路由 `/`、`/account/register`；使用简洁双 Tab 结构，不复制 mock 状态。
2. **A2 账号接口（已完成）**：接入未验证邮箱登录和直接注册；错误、唯一性冲突、限流、会话和入房状态使用真实后端事件。
3. **A3 账号与资料（已完成）**：`/account/security` 已通过真实 Socket 支持上传/更换/恢复默认头像，以及修改昵称、密码、登录邮箱和撤销其他会话；头像在浏览器端裁切后随资料事件持久化，并即时同步当前房间座位。账号资料会话与座位会话分离，无座也可维护资料，并有失效/超时错误态及敏感输入清理。
4. **A4 管理员账号维护（已完成）**：`/admin/accounts` 与 `/admin/room` 已生产化；`admin:login(intent=manage)` 只建立后台会话，`admin:enterRoom` 才显式进入/确认接管，账号维护、审计原因、强退/停用/恢复/软删除和房间请出均接真实事件；`/admin/*` 不提交玩家账号/座位凭证。
5. **A5 验收（本地自动化已完成）**：类型检查、生产构建、服务端回归和账号/管理员 Playwright 已通过；Railway Volume 与移动端真机仍属于发布环境人工验收，完成前保留 `/prototype/*` 参考入口。

---

## 8. 前端测试专项（Playwright E2E）

除里程碑里的本地双开联调外，补一组前端 E2E 场景（与后端 [§4 测试策略](backend-dev-plan.md) 互补，前端只验证 UI 行为与不泄漏，不重复服务端判定）：

- **2–4 人登录与容量**：多个浏览器依次进房，四座、房主、准备态在各端一致；第 5 人收到「房间已满」。
- **账号认证**：未验证邮箱登录、直接注册、无找回提示、重新登录和在线会话接管由真实 [`accounts.spec.ts`](../client/e2e/accounts.spec.ts) 覆盖；无座资料维护、会话失效错误态与敏感输入清理由 [`account-security.spec.ts`](../client/e2e/account-security.spec.ts) 覆盖；Prototype 测试只保留视觉参考。
- **结束游戏回大厅**：任一在座玩家结束局中流程后，两端均进入准备 Lobby，原座位仍在、真人准备态清空且可重新准备，由 [`end-game-return-lobby.spec.ts`](../client/e2e/end-game-return-lobby.spec.ts) 覆盖。
- **抢先手并发**：两端几乎同时 `card:place`，仅首个生效、另一端即时锁定灰显，无错位。
- **断线重连**：杀掉一端连接 → `reconnecting`「正在恢复座位…」→ 恢复后界面按 `room:state` 重建（含 host）；超保留期回登录页。
- **提示弹窗超时**：弹窗 5s 不操作 → 由服务端状态关闭（按 No），焦点/`inert`/Esc-不关 行为正确。
- **移动端出牌**：390px 与常见横屏视口下，页面允许滚动且钟面、状态条、手牌均可达；旋转后滚动与交互状态正常恢复。
- **不可见牌值不入 DOM（安全关键）**：断言对己未翻盲牌、桌面未用标记的暗牌、队友手牌的 value **既不渲染、也不出现在任何 DOM 属性 / data-\* 中**——后端遮蔽的镜像校验，防前端二次泄漏。

---

## 9. 待前端确认 / 依赖项
- 关卡不携带 deck；固定 24 张牌库每局抽 12 张，前端只渲染服务端下发的可见牌信息。
- 钟面 6 段的**视觉编号方向**（顺时针 S1→S6 起点）需与服务端 `placements` 索引 0–5 约定一致，渲染前锁定。
- 暗置牌「磨砂铜片」与提示明置牌「黄铜发光」的具体 SVG/材质稿，进入 M3/M4 时细化。
- logo 钟形 SVG 与噪点纹理资源，M0 末补齐。

### 9.1 扩展预留范围（N 人 + agent）—— 统一口径
> M8 的固定 4 座、2–4 人弹性开局、dealRules 可见性和 Agent 加/撤入口已基本落地，不再属于“仅预留”。M9 的真实模型、每座位策略和 attempt memory 仍由服务端实现；前端只展示 Agent 座位、公开消息、公开策略摘要、思考/降级状态和结构化复盘数据。

### 9.2 品牌与公开发布约定
- 当前私用原型和代码统一展示 **Take Time**，内部目录/包名使用 `take_time`。
- 「午夜天文台 · 黄铜机械」主题为本项目的原创视觉表达。
- 若转为公开发行或商业发布，品牌命名、素材和版权风险必须另行评审；不得只依赖本文旧口径直接上线。

### 9.3 Future Work：关卡自适应主题（M7+）
当前所有已设计关卡统一为 **★**，前端使用默认主题展示。后续若重新引入多星难度，可再按关卡难度扩展 `data-difficulty` 主题覆写。
