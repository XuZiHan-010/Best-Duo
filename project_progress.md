# Project Progress

> 更新时间：2026-07-13（含移动端视口修复实施）
> 口径：记录**当前本地工作区**的开发完成度与下一步优先级；M8、M9 框架、本轮移动端视口修复和文档调整尚未全部进入当前 Git HEAD。更细的设计与执行细节见 [`docs/`](docs/) 与 [`plans/`](plans/)。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| 已完成 | 主功能已落地，并已有基本验证或可联调用例。 |
| 基本完成 | 主流程可用，代码层面已落地，但仍需要全量测试、人工验收、Railway 验收或文档回写。 |
| 进行中 | 已有部分实现，尚未达到该里程碑验收口径。 |
| 未开始 | 尚未正式实现。 |
| 待定 | 依赖用户补充内容或范围确认。 |

## 最近验证快照（2026-07-13，移动端视口修复后）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 全量构建 | 通过 | `npm run build`（shared → client tsc + vite → server tsc）全部通过。 |
| 服务端测试 | 通过 | 8 个测试文件、74 个测试全部通过（含改写后的“同昵称接管席位”用例）。 |
| 移动端专项 E2E | 通过 | 新增/重写的 `mobile-placing-layout.spec.ts`（3 项）与 `mobile-discussion-orientation.spec.ts`（3 项）在隔离与移动端组合运行下 6/6 稳定通过。 |
| 最新工作区全量 Playwright | 24/25 | 唯一失败为 `state-sync.spec.ts` 重连状态同步；该用例隔离运行稳定通过（复测 2/2），失败源于套件预存的串行污染 flaky（单一全局房间、旧用例结束不关闭 context），非本轮改动引入，且优于此前 23/25。 |
| Railway 生产验收 | 待运行 | Volume 上的 `progress.json` 跨重启保留、WebSocket、`SIGTERM` flush 仍需真实环境验证；进行中对局重启后按设计清空，不做恢复。 |
| 真机验收 | 待运行 | iOS Safari / Android Chrome 上的横竖屏切换、地址栏伸缩、安全区、软键盘等仍需真机验证（见方案 §10 矩阵）。 |

> 注意：上述结果证明当前本地工作区的构建与服务端测试健康；它不代表尚未提交的改动已经进入远端仓库或 Railway 部署版本。

## 总览

当前项目是单房间 2–4 人 Web 原型。后端 MVP M0-M6 已完成，M7 的代码侧 review follow-ups 已基本完成，剩余全量 E2E 与 Railway 生产验收。M8 弹性扩容后端与前端主代码已基本落地：固定 4 座、弹性开始校验、按实际人数发牌和多人 UI 已实现，但 3/4 人完整 Socket 对局、完整 Playwright 对局和多人/多 Agent 人工验收尚未完成。M9 的加/撤 Agent、registry、handoff 和前端 UI 已有框架，当前仍使用脚本化策略；真实 Agent 将按 `attemptId + TeamStrategy + 外部 memory + OpenAI/DeepSeek 双 Provider` 的新版架构实施。

前端核心联调界面已推进到可完整承接服务端主流程的阶段。本轮前端 review fixes 已经大量落地：重连/离线禁操作、移动端 placing 布局、HintPrompt focus trap、LevelSelect 只读语义、Pill 方向键、skip link、聊天 input `name`、倒计时 `requestAnimationFrame`、隐藏牌 DOM 泄漏检测、选段错位修复等都有对应实现和 Playwright E2E 用例。

**2026-06-17 更新汇总**：揭示（Reveal）阶段现在暂停等待房主手动确认后再进入结算，移除了原来的自动推进计时器；新增 `game:continueToResult` 服务端事件、客户端 socket adapter 对应封装，以及 Reveal 视图中房主专属“继续”按钮。同日还完成了 README 双语部署说明、Railway 构建链路修复、文档目录口径从 `plans/` 迁移到 `docs/`、规则/PRD/技术方案同步、Level 02 条件微调，以及隐藏牌可见性、出牌动作校验和 socket 流程测试补强。下一步重点从“补代码”转为“全量验收与回归”。

**2026-06-18 更新汇总**：Level 05–10 已补齐 Markdown 设计稿并同步到运行时关卡数据，`levels/README.md`、AGENTS 索引和相关 PRD/技术文档已同步更新。条件体系新增 `min-color-cards` 与 `has-duplicate-value`，并补齐 shared 类型、后端条件引擎、求解器、前端条件文案 / 区段提示和单测覆盖；发牌前可解性校验已能识别这些新条件。为方便本地测试，非生产服务端允许房主选择所有关卡，前端在本地地址也展示全部关卡可选；production 仍保留原顺序解锁逻辑，并新增 socket 回归测试保护线上行为。已验证 `npm.cmd run test -w @take-time/server`、`npm.cmd run typecheck -w @take-time/client`、`npm.cmd run typecheck -w @take-time/server` 通过。

**2026-06-19 更新汇总**：补强了 `room:state` 同步可靠性：shared 状态新增 `stateVersion` 与 `shouldAcceptRoomState`，服务端每次广播 / 单 socket 同步时推进版本号，客户端拒绝旧版本状态，并在重连或页面重新可见时主动发送 `room:sync` 拉取最新状态；同时补了服务端版本递增单测和前端 Playwright 状态同步回归，覆盖队友离线后重新连接仍能看到最新 pending hint 的场景。前端继续收口 placing / reveal / result 的移动端体验与提示可读性，包括 TopBar 安全区、Reveal/Result 窄屏纵向布局、时钟区段提示与幽灵卡堆错开、提示等待文案和符号调整。关卡内容也做了新一轮整理：原 5-12 关顺序重排，新增 Level 07“七八九禁区”和 Level 13“双锚点”，并同步 `levels/README.md`、各关 Markdown、运行时 `server/src/levels/data.ts` 与 loader 单测。

**2026-06-24 更新汇总（M8/M9 开发）**：M8 弹性扩容后端已完成：`createSeats` 固定传 4、`capacity` 从 `2` 改为 `4`、`settingsUpdateSchema` 移除 capacity 字段、新增 `canStartGame`/`occupiedSeats`/`humanSeats` 辅助函数、`deal.ts` 按实际落座人数路由 `dealRules`、shared 新增 `handSizeForPlayerCount`。M8 前端也已同步完成：`selectors.ts` 新增 `teammateSeatsSelector`/`occupiedCountSelector`/`allReadySelector`，`canStartSelector` 对齐后端逻辑，`Placing.tsx` 改用 `teammates.map` 渲染多队友（含 AI 思考中文案），`SettingsPanel` 移除人数选项改为只读说明，`Lobby` 渲染全部 4 个座位并支持添加/移除 AI。M9 后端框架已完成：`HostAddAgent`/`HostRemoveAgent` handler、`InMemoryAgentRegistry`、`scriptedAgent`（占位）、`agentDriver`、`handoff.ts` Agent 出牌/hint 接入循环。M9 前端也已就绪：Lobby AI 添加/移除 UI、Placing AI 状态文案、Agent 消息样式和 adapter。该时间点真实 LLM 与讨论调用尚未实现；当时拟用的 Claude 路线已被 2026-07-13 新架构替代。**2026-06-25 bug 修复**：`handoff.ts` while 循环 Agent placement 后缺少 `afterRevealIfNeeded` 调用已修复。

**2026-07-13 架构收口**：新增 `docs/architecture.md`、3 份 ADR 与 `plans/m9-agent-implementation-plan.md`。废弃 Claude/Anthropic 单模型路线、单一 `AgentRoomView`、独立 hint LLM 调用和仅靠 `Promise.race` 的超时方案。M9 改为：讨论/策略与实时出牌分任务路由；每个 attempt 隔离团队策略和私人 memory；placement 与 hint 合并；请求使用 `AbortController`；候选评分不得读取真实隐藏牌。面试版本持久化目标调整为 PostgreSQL 保存进度、attempt、策略和 Agent telemetry，实时对局仍在内存。

**2026-07-13 移动端视口修复实施（按 `plans/2026-07-10-mobile-gameplay-viewport-fixes.md`）**：落地了讨论/出牌阶段的手机竖屏、短横屏与旋转修复。
- **单一滚动模型**：`.room-view__main` 成为唯一页面级纵向滚动容器（`overflow-y:auto` + `overscroll-behavior` + `dvh` 外壳）；移除出牌页 `overflow:hidden` 与 Reveal 的内部 `overflow-y:auto`，各阶段视图改为自然高度（`flex:0 0 auto; min-height:100%`）。
- **响应式分层**：把原 `≤767px` 媒体块按“方向无关 / 竖屏专属 / 短横屏（`orientation:landscape and max-height:600px`）”三类拆分；出牌页短横屏改用 grid 双区布局，转盘按宽高双约束缩放不再硬塞一屏。
- **HintPrompt 遮罩**改为 `position:fixed`，避免长页面滚动后带倒计时的提示弹窗定位到视口外。
- **等待态样式**：`Discussion.tsx` 的非房主/断线提示从 `.view-stub`（`flex:1`）改为专用 `.discussion__status`（`role=status`、不 `flex-grow`），不再吞高度、遮挡转盘。
- **index.html** 补 `viewport-fit=cover`；相关安全区 `env(safe-area-inset-*)` 生效。
- **E2E**：新增 `mobile-discussion-orientation.spec.ts` 并重写 `mobile-placing-layout.spec.ts`（删除过时的 `no-scroll` 契约，改测无重叠/可滚动到达/旋转重排/弹窗可见）；`helpers.ts` 支持向 `browser.newContext()` 传 viewport 并新增讨论/reveal 阶段 setup。
- **顺带修复的预存缺陷**：① 进入出牌阶段必崩的 React #185——`teammateSeatsSelector` 每次返回新数组导致 zustand 无限重渲染，改用 `useShallow` 包裹；② “同昵称重连被锁至旧连接 ping 超时”——`room:reset` 现会切断其它遗留连接，`player:join` 遇同昵称+正确密码改为踢旧连接接管席位（并改写对应服务端单测）；③ 修正 `reconnect`/`hint-timeout` 两个用例中与现源码漂移的过时断言字符串（`已准备 ✓`、`◉ 轮到你出牌`、`等待准备…`）。

## 后端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | npm workspaces 三包、shared 类型、Express + Socket.IO、`/healthz`、Railway 配置、构建/启动脚本。 | 已完成 | 单服务部署基础已就位。 |
| M1 条件引擎 + 关卡数据 | `conditionEngine.ts`、关卡 loader、区段 1-6 到 0-5 归一化、条件单测。 | 已完成 | 已支持当前 1-13 关条件；`min-color-cards`、`has-duplicate-value`、`forbidden-values` 已接入关卡数据、loader 测试和前端文案。 |
| M2 入座 / 准备 / 房主 + payload 校验 | `player:join`、同昵称重连、准备、房主产生、zod 入站校验、`room:state` / `room:error`。 | 已完成 | 重复昵称、补位、进行中离开等边界已按 follow-ups 收口。2026-07-13：同昵称+正确密码不再被拒（`该昵称已在房间中`），改为切断旧（可能半死）连接、由重连路径接管席位，避免旧 socket ping 超时前一直锁号；`room:reset` 同时切断其它遗留连接。 |
| M3 选关 / 讨论 / 持久化读 | 房主开始、选关、进入讨论、讨论计时、聊天、启动加载进度。 | 已完成 | 进度与设置持久化路径已落地；本地/非生产允许全关卡测试，production 仍按通关进度顺序解锁。 |
| M4 出牌核心 | 发牌规则、可见性、动作层 `applyPlacement`、抢先手、交替回合、回合计时、超时判负、私有手牌遮蔽。 | 已完成 | 固定 24 张牌库、随机抽 12 张、可解性校验已接入。 |
| M5 提示系统 | `pendingHint` 5 秒窗口、`hint:decide`、提示标记额度、提示翻开牌公共可见、提示期间暂停。 | 已完成 | 提示窗口超时按 No，不判负。 |
| M6 揭示 / 结算 / 写盘 | 放满 12 张自动揭示、统计 6 段、条件校验、成功写通关进度、下一关 / 重试 / 返回选关。 | 已完成 | 失败原因、通关推进和写盘失败反馈已收口。 |
| M7 打磨 + Railway 验收 | 非生产禁用 `room:reset`、断线保留、host 转移、计时器幂等、可见性防泄漏、payload 测试、Railway 端到端验收。 | 基本完成 | 代码侧 follow-ups 已处理，当前 typecheck 与 74 个服务端测试通过；Railway 构建配置已改为单次 `npm run build` 并修复 shared/client/server 构建产物路径问题。仍需跑最新全量 Playwright，并在真实 Railway 验证 Volume 进度保留、WebSocket 与 `SIGTERM` flush。 |
| M8 3/4 人 | 固定 4 座并支持 2–4 人弹性开局；补齐 3/4 人发牌、可见性、回合、结算、socket 流程和测试。 | 基本完成 | 后端弹性扩容和前端多人 UI 已落地；已有 `canStartGame`、3/4 人发牌可见性、4 人入座/第 5 人拒绝、1 真人+Agent 开局测试。仍缺 3/4 人完整 Socket 对局、完整 Playwright 对局和多人移动端验收。 |
| M9 协作 Agent | attempt memory、讨论与策略收口、实时出牌、候选评估、双 Provider、deadline、telemetry。 | 进行中 | 加/撤 Agent、registry、handoff 和前端基础 UI 已完成；M9.0 的 `attemptId`、视图拆分、TeamStrategy 与 memory 尚未开始，当前仍使用脚本策略。 |
| M10 PostgreSQL + 可观测性 | 迁移 progress/settings，保存 attempt、TeamStrategy、Agent 决策与模型指标。 | 未开始 | 实时 GameRoom 与本局 memory 继续留在内存，不承诺中途重启恢复。 |
| M11 Agent Eval / 复盘 | 通关率、延迟、fallback、成本、策略和决策轨迹页面。 | 未开始 | 以固定种子和遮蔽视图做模型对照。 |

### 后端当前重点

- **先收口 M7/M8 验证**：重新跑最新全量 Playwright；补 3/4 人完整 Socket/E2E、多 Agent 连续回合、1 真人+Agent 抢先手和多人移动端验收。
- **M9.0 领域架构**：实现 `attemptId`、`DiscussionView`/`TurnView`、`TeamStrategy`、共享/私人 memory、`ModelClient` 与 mock 流程。
- **M9.1–M9.2**：讨论顺序调度与策略收口；接入 DeepSeek/OpenAI adapter；placement+hint 合并；Abort 和 stale response 防护。
- **M9.3–M9.5**：安全候选、启发式/信念评分、Agent 抢先手、telemetry 与 PostgreSQL repository 准备。
- 当前 `npm.cmd run typecheck` 与 `npm.cmd test` 已通过；后续每批 M8/M9 改动后继续重跑，防止破坏 M0-M7。
- 在 Railway 上验证真实生产行为：Volume 路径、`progress.json` 跨重启保留、进行中对局重启后清空、WebSocket 同步、`SIGTERM` flush。

## 前端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | Vite + React + TS、tokens、字体、socket 单例、`useRoomStore`、`RoomView` 按 phase 切换。 | 已完成 | 前端项目、store、socket 基础已搭好。 |
| M1 登录 + 大厅 | Login、`player:join`、Lobby 座位 / 准备 / 房主徽标 / 设置面板 / 开始确认、接 `room:state`。 | 已完成 | V1 双人流程已完成；现行 M8 已升级为固定 4 座、2–4 人弹性开局。 |
| M2 选关 + 讨论 | LevelSelect 网格、已通关标记、规则说明、RulesPanel、聊天、讨论倒计时、房主提前开始。 | 基本完成 | 已改用真实关卡摘要；非房主只读语义和 `content-visibility` 已收口，待全量回归。 |
| M3 出牌核心 | 三栏布局、ClockBoard、HandRail、抢先手 / 交替态、回合倒计时、自由放置交互。 | 基本完成 | 区段 0/1-based 错位已修；S1/S6 出牌路径有 E2E 覆盖。 |
| M4 提示系统 | HintMarkers、HintPrompt 5 秒弹窗、暂停态、提示翻开牌展示。 | 基本完成 | focus trap、背景 `inert`、提示超时 E2E 已补；仍建议手动验收读屏与键盘体验。 |
| M5 揭示 + 结算 | Reveal 翻牌 / 总和 / 条件逐条亮灯；Result 成功 / 失败 / 复盘 / 房主按钮。 | 基本完成 | 揭示阶段已改为房主主动确认推进（`game:continueToResult`），移除自动计时；结算二次确认、超时结果展示等已补；待完整端到端回归。 |
| M6 打磨 | 动效、`reduced-motion`、响应式、移动端 placing、连接 / 重连 / 离线三态、空 / 错 / 超长态、Playwright E2E。 | 基本完成 | review fixes 已大体落地，新增重连禁操作、主动 room sync、移动端布局、focus trap、skip link、Pill 键盘、隐藏牌防泄漏等 E2E；2026-07-13 完成移动端视口修复（单一滚动容器、竖屏/短横屏分层、HintPrompt fixed 遮罩、`viewport-fit=cover`），新增/重写移动端 E2E 6/6 通过，最新全量 24/25（唯一失败为套件预存的 `state-sync` 串行污染 flaky，隔离通过）。真机横竖屏与安全区仍待人工验收。 |
| M7 上线验收与回归硬化 | 前端 build/typecheck/e2e 全绿；本地双开完整流程验收；Railway 页面和 Socket 行为验收；文档口径回写。 | 进行中 | 当前根目录 typecheck 已通过，两个既有失败场景的定向复测已通过；仍缺最新全量 Playwright、本地多人完整流程和 Railway 手动验收。 |
| M8 3/4 人前端支持 | UI 固定展示 4 座并按实际就位人数派生座位、TopBar、回合、手牌数量和可见性；补多人 E2E。 | 基本完成 | `teammateSeatsSelector`/`occupiedCountSelector`/`allReadySelector`/`canStartSelector` 已实装；`Placing.tsx` 改为 `teammates.map` 多队友渲染；`SettingsPanel` 移除容量选项；`Lobby` 渲染全 4 座位并支持添加/移除 AI；多人 E2E 待补。 |
| M9 Agent 前端支持 | Agent 座位、消息、加/撤入口、思考/降级状态、策略摘要。 | 进行中 | 基础座位、消息和入口已完成；待增加当前 TeamStrategy 摘要、Agent 不可用/fallback 状态与复盘入口。 |

### 前端当前重点

- 治理 E2E 套件的串行污染 flaky：唯一残余失败 `state-sync.spec.ts` 隔离稳定通过、全量偶发失败，根因是单一全局房间 + 旧用例结束不关闭 `browser.newContext()`；建议给旧用例统一补 `afterEach` 关 context（移动端两个新用例已补），使全量稳定 25/25。
- 真机验收移动端视口修复：iOS Safari / Android Chrome 上横竖屏切换、地址栏伸缩、安全区、软键盘不遮挡输入（对照 `plans/2026-07-10-mobile-gameplay-viewport-fixes.md` §10 矩阵）。
- 用本地多浏览器标签完整走 2 人 / 3 人局（加 AI 补位），验收 Lobby AI 添加/移除、Placing 多队友栏显示正确。
- 对 review fixes 做人工 UI/a11y 验收：窄屏 placing、Reveal/Result、HintPrompt 焦点循环、断线只读态、时钟提示不重叠。
- 补多人 E2E（3/4 人弹性开局、AI 补位可开始）。

## 关卡与内容

| 项目 | 当前状态 | 备注 |
| --- | --- | --- |
| 关卡目录结构 | 已完成 | `levels/` 已建立，一关一个 Markdown 文件。 |
| 前 13 关设计 | 已完成 | 已纳入 [`levels/README.md`](levels/README.md)，Level 5-13 已补齐 / 重排 Markdown 文件并同步到运行时关卡数据；Level 07 与 Level 13 为本轮新增。 |
| 规则权威来源 | 已完成 | [`rules.md`](rules.md) 是机制权威口径。 |
| Level 02 条件同步 | 已完成 | 2026-06-17 已微调并同步到运行时关卡数据与文档口径。 |
| 总关卡数 N | 待定 | 需要用户确认，例如 40 关或其他数量。 |
| 第 14 关及后续关卡 | 未开始 | 新增关卡后需同步更新索引，并跑求解器 / 条件展示 / 通关推进验证；当前本地测试可直接选任意已存在关卡。 |

## 建议执行顺序

1. **M7/M8.1 收口**：重跑全量 Playwright；补 3/4 人完整 Socket/E2E、1 真人+Agent 抢先手、多 Agent 连续回合与 Railway 验收。
2. **M9.0**：attempt、视图、TeamStrategy、memory 与 mock Agent。
3. **M9.1–M9.2**：讨论/策略、OpenAI+DeepSeek、实时决策、Abort 与 fallback。
4. **M9.3–M9.5**：候选评估、Agent race、telemetry。
5. **M10–M11**：PostgreSQL、Agent eval 与复盘页。
6. **持续补关卡**：第 14 关起每批加入后跑求解器与核心流程回归。

