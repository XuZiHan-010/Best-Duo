# Project Progress

> 更新时间：2026-06-19
> 用途：记录当前开发完成度与下一步优先级。更细的设计与执行细节见 [`docs/`](docs/)。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| 已完成 | 主功能已落地，并已有基本验证或可联调用例。 |
| 基本完成 | 主流程可用，代码层面已落地，但仍需要全量测试、人工验收、Railway 验收或文档回写。 |
| 进行中 | 已有部分实现，尚未达到该里程碑验收口径。 |
| 未开始 | 尚未正式实现。 |
| 待定 | 依赖用户补充内容或范围确认。 |

## 总览

当前项目是单房间双人 Web 原型。后端 MVP M0-M7 主流程与 review follow-ups 已基本完成，代码仍保持 2 人 MVP 锁定；M8 的 3/4 人 `capacity` 尚未正式开放，虽然 `dealRules`、座位数组化和共享类型已经为 3/4 人预留。

前端核心联调界面已推进到可完整承接服务端主流程的阶段。本轮前端 review fixes 已经大量落地：重连/离线禁操作、移动端 placing 布局、HintPrompt focus trap、LevelSelect 只读语义、Pill 方向键、skip link、聊天 input `name`、倒计时 `requestAnimationFrame`、隐藏牌 DOM 泄漏检测、选段错位修复等都有对应实现和 Playwright E2E 用例。

**2026-06-17 更新汇总**：揭示（Reveal）阶段现在暂停等待房主手动确认后再进入结算，移除了原来的自动推进计时器；新增 `game:continueToResult` 服务端事件、客户端 socket adapter 对应封装，以及 Reveal 视图中房主专属“继续”按钮。同日还完成了 README 双语部署说明、Railway 构建链路修复、文档目录口径从 `plans/` 迁移到 `docs/`、规则/PRD/技术方案同步、Level 02 条件微调，以及隐藏牌可见性、出牌动作校验和 socket 流程测试补强。下一步重点从“补代码”转为“全量验收与回归”。

**2026-06-18 更新汇总**：Level 05–10 已补齐 Markdown 设计稿并同步到运行时关卡数据，`levels/README.md`、AGENTS 索引和相关 PRD/技术文档已同步更新。条件体系新增 `min-color-cards` 与 `has-duplicate-value`，并补齐 shared 类型、后端条件引擎、求解器、前端条件文案 / 区段提示和单测覆盖；发牌前可解性校验已能识别这些新条件。为方便本地测试，非生产服务端允许房主选择所有关卡，前端在本地地址也展示全部关卡可选；production 仍保留原顺序解锁逻辑，并新增 socket 回归测试保护线上行为。已验证 `npm.cmd run test -w @take-time/server`、`npm.cmd run typecheck -w @take-time/client`、`npm.cmd run typecheck -w @take-time/server` 通过。

**2026-06-19 更新汇总**：补强了 `room:state` 同步可靠性：shared 状态新增 `stateVersion` 与 `shouldAcceptRoomState`，服务端每次广播 / 单 socket 同步时推进版本号，客户端拒绝旧版本状态，并在重连或页面重新可见时主动发送 `room:sync` 拉取最新状态；同时补了服务端版本递增单测和前端 Playwright 状态同步回归，覆盖队友离线后重新连接仍能看到最新 pending hint 的场景。前端继续收口 placing / reveal / result 的移动端体验与提示可读性，包括 TopBar 安全区、Reveal/Result 窄屏纵向布局、时钟区段提示与幽灵卡堆错开、提示等待文案和符号调整。关卡内容也做了新一轮整理：原 5-12 关顺序重排，新增 Level 07“七八九禁区”和 Level 13“双锚点”，并同步 `levels/README.md`、各关 Markdown、运行时 `server/src/levels/data.ts` 与 loader 单测。

## 后端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | npm workspaces 三包、shared 类型、Express + Socket.IO、`/healthz`、Railway 配置、构建/启动脚本。 | 已完成 | 单服务部署基础已就位。 |
| M1 条件引擎 + 关卡数据 | `conditionEngine.ts`、关卡 loader、区段 1-6 到 0-5 归一化、条件单测。 | 已完成 | 已支持当前 1-13 关条件；`min-color-cards`、`has-duplicate-value`、`forbidden-values` 已接入关卡数据、loader 测试和前端文案。 |
| M2 入座 / 准备 / 房主 + payload 校验 | `player:join`、同昵称重连、准备、房主产生、zod 入站校验、`room:state` / `room:error`。 | 已完成 | 重复昵称、补位、进行中离开等边界已按 follow-ups 收口。 |
| M3 选关 / 讨论 / 持久化读 | 房主开始、选关、进入讨论、讨论计时、聊天、启动加载进度。 | 已完成 | 进度与设置持久化路径已落地；本地/非生产允许全关卡测试，production 仍按通关进度顺序解锁。 |
| M4 出牌核心 | 发牌规则、可见性、动作层 `applyPlacement`、抢先手、交替回合、回合计时、超时判负、私有手牌遮蔽。 | 已完成 | 固定 24 张牌库、随机抽 12 张、可解性校验已接入。 |
| M5 提示系统 | `pendingHint` 5 秒窗口、`hint:decide`、提示标记额度、提示翻开牌公共可见、提示期间暂停。 | 已完成 | 提示窗口超时按 No，不判负。 |
| M6 揭示 / 结算 / 写盘 | 放满 12 张自动揭示、统计 6 段、条件校验、成功写通关进度、下一关 / 重试 / 返回选关。 | 已完成 | 失败原因、通关推进和写盘失败反馈已收口。 |
| M7 打磨 + Railway 验收 | 非生产禁用 `room:reset`、断线保留、host 转移、计时器幂等、可见性防泄漏、payload 测试、Railway 端到端验收。 | 基本完成 | 代码侧 follow-ups 已处理；Railway 构建配置已改为单次 `npm run build` 并修复 shared/client/server 构建产物路径问题；真实 Railway Volume、重启、WebSocket、`SIGTERM` flush 仍建议继续验收。 |
| M8 3/4 人 | 放开 `capacity` 3/4；补齐 3/4 人发牌、可见性、回合、结算、socket 流程和测试。 | 未开始 | 当前 `settings:update` 和 schema 仍锁 `capacity: 2`；`dealRules` 和数据结构已有预留。 |
| M9 LLM-agent | 实现 `PlayerAgent`、`agentDriver`、agent 讨论发言 / 出牌 / 提示决策、超时兜底、房主加 / 撤 agent。 | 未开始 | 后端已有类型和动作层预留，尚未接具体 agent。 |

### 后端当前重点

- 对 M0-M7 继续跑完整回归；2026-06-18 已通过服务端测试、客户端 typecheck、服务端 typecheck，2026-06-19 已新增状态版本 / room sync 单测与 E2E 覆盖，仍建议补根目录全量 `npm run typecheck`、`npm test` 与前端 E2E。
- 在 Railway 上验证真实生产行为：Volume 路径、`progress.json` 保留、重启恢复、WebSocket 同步、`SIGTERM` flush。
- 对 Railway 最新构建链路做一次真实部署确认：Nixpacks 使用仓库 `railway.json`，构建命令为 `npm run build`，启动命令为 `npm start`。
- M8 开始前先明确是否继续维持“2 人 MVP 先验收完再放开 3/4 人”的节奏。

## 前端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | Vite + React + TS、tokens、字体、socket 单例、`useRoomStore`、`RoomView` 按 phase 切换。 | 已完成 | 前端项目、store、socket 基础已搭好。 |
| M1 登录 + 大厅 | Login、`player:join`、Lobby 座位 / 准备 / 房主徽标 / 设置面板 / 开始确认、接 `room:state`。 | 已完成 | 能进入房间并完成准备 / 房主流程；容量仍按 2 人 MVP 锁定。 |
| M2 选关 + 讨论 | LevelSelect 网格、已通关标记、规则说明、RulesPanel、聊天、讨论倒计时、房主提前开始。 | 基本完成 | 已改用真实关卡摘要；非房主只读语义和 `content-visibility` 已收口，待全量回归。 |
| M3 出牌核心 | 三栏布局、ClockBoard、HandRail、抢先手 / 交替态、回合倒计时、自由放置交互。 | 基本完成 | 区段 0/1-based 错位已修；S1/S6 出牌路径有 E2E 覆盖。 |
| M4 提示系统 | HintMarkers、HintPrompt 5 秒弹窗、暂停态、提示翻开牌展示。 | 基本完成 | focus trap、背景 `inert`、提示超时 E2E 已补；仍建议手动验收读屏与键盘体验。 |
| M5 揭示 + 结算 | Reveal 翻牌 / 总和 / 条件逐条亮灯；Result 成功 / 失败 / 复盘 / 房主按钮。 | 基本完成 | 揭示阶段已改为房主主动确认推进（`game:continueToResult`），移除自动计时；结算二次确认、超时结果展示等已补；待完整端到端回归。 |
| M6 打磨 | 动效、`reduced-motion`、响应式、移动端 placing、连接 / 重连 / 离线三态、空 / 错 / 超长态、Playwright E2E。 | 基本完成 | review fixes 已大体落地，新增多条 E2E：重连禁操作、主动 room sync、移动端布局、focus trap、skip link、Pill 键盘、隐藏牌防泄漏等；移动端 TopBar、Reveal/Result 和时钟提示重叠已继续微调。尚需跑全套验证。 |
| M7 上线验收与回归硬化 | 前端 build/typecheck/e2e 全绿；本地双开完整流程验收；Railway 页面和 Socket 行为验收；文档口径回写。 | 进行中 | E2E 基础已经建立，状态同步回归已补强，下一步应集中在全量跑测、修剩余回归和 Railway 手动验收。 |
| M8 3/4 人前端支持 | UI 放开 `capacity` 3/4；座位、TopBar、回合、手牌数量、可见性按 N 人派生；补多人 E2E。 | 未开始 | 需配合后端 M8；当前只保留结构预留，不应对外开放。 |
| M9 agent 前端支持 | agent 座位展示、agent 聊天消息样式、房主加 / 撤 agent 入口、agent 思考中状态。 | 未开始 | 需配合后端 M9；前端只展示服务端注入状态，不直接调用 LLM。 |

### 前端当前重点

- 跑全量验证并修回归：`npm run typecheck`、`npm run test:e2e -w @take-time/client`，必要时补 `npm test`；重点留意新增 `state-sync.spec.ts` 的离线 / 重连同步路径。
- 用本地双浏览器完整走一局：登录、准备、选关、讨论、出牌、提示、揭示、结算、重试 / 返回选关。
- 对 review fixes 做人工 UI/a11y 验收：窄屏 placing、Reveal/Result、HintPrompt 焦点循环、非房主 LevelSelect、断线只读态、隐藏牌值不进 DOM、时钟提示不重叠。
- 验收通过后，补一份前端 review fixes 完成记录，或在对应 review 文档中把已解决项和仍保留的取舍写清楚。

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

1. 先做一次全量本地回归：根目录 `npm run typecheck`、`npm test`、`npm run test:e2e -w @take-time/client`。
2. 修掉回归里暴露的前端 M6/M7 剩余问题，并做双浏览器人工验收。
3. 在 Railway 上验收 M7：构建成功、页面加载、Socket 同步、Volume 进度保留、重启语义、`SIGTERM` flush。
4. 回写 review 文档，把已解决项和仍保留的取舍写清楚。
5. 再进入 M8：后端先放开 `capacity` 3/4 与测试，前端同步解除 UI 锁定并补多人 E2E。
6. 持续补关卡内容；每批关卡加入后跑求解器与核心流程回归。

