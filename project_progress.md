# Project Progress

> 更新时间：2026-06-16  
> 用途：记录当前开发完成度与下一步优先级。更细的设计与执行细节见 [`plans/`](plans/)。

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

前端核心联调界面已推进到可完整承接服务端主流程的阶段。本轮前端 review fixes 已经大量落地：重连/离线禁操作、移动端 placing 布局、HintPrompt focus trap、LevelSelect 只读语义、Pill 方向键、skip link、聊天 input `name`、倒计时 `requestAnimationFrame`、隐藏牌 DOM 泄漏检测、选段错位修复等都有对应实现和 Playwright E2E 用例。下一步重点从“补代码”转为“全量验收与回归”。

## 后端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | npm workspaces 三包、shared 类型、Express + Socket.IO、`/healthz`、Railway 配置、构建/启动脚本。 | 已完成 | 单服务部署基础已就位。 |
| M1 条件引擎 + 关卡数据 | `conditionEngine.ts`、关卡 loader、区段 1-6 到 0-5 归一化、条件单测。 | 已完成 | 已支持当前关卡条件；关卡内容仍会继续扩展。 |
| M2 入座 / 准备 / 房主 + payload 校验 | `player:join`、同昵称重连、准备、房主产生、zod 入站校验、`room:state` / `room:error`。 | 已完成 | 重复昵称、补位、进行中离开等边界已按 follow-ups 收口。 |
| M3 选关 / 讨论 / 持久化读 | 房主开始、选关、进入讨论、讨论计时、聊天、启动加载进度。 | 已完成 | 进度与设置持久化路径已落地。 |
| M4 出牌核心 | 发牌规则、可见性、动作层 `applyPlacement`、抢先手、交替回合、回合计时、超时判负、私有手牌遮蔽。 | 已完成 | 固定 24 张牌库、随机抽 12 张、可解性校验已接入。 |
| M5 提示系统 | `pendingHint` 5 秒窗口、`hint:decide`、提示标记额度、提示翻开牌公共可见、提示期间暂停。 | 已完成 | 提示窗口超时按 No，不判负。 |
| M6 揭示 / 结算 / 写盘 | 放满 12 张自动揭示、统计 6 段、条件校验、成功写通关进度、下一关 / 重试 / 返回选关。 | 已完成 | 失败原因、通关推进和写盘失败反馈已收口。 |
| M7 打磨 + Railway 验收 | 非生产禁用 `room:reset`、断线保留、host 转移、计时器幂等、可见性防泄漏、payload 测试、Railway 端到端验收。 | 基本完成 | 代码侧 follow-ups 已处理；真实 Railway Volume、重启、WebSocket、`SIGTERM` flush 仍建议继续验收。 |
| M8 3/4 人 | 放开 `capacity` 3/4；补齐 3/4 人发牌、可见性、回合、结算、socket 流程和测试。 | 未开始 | 当前 `settings:update` 和 schema 仍锁 `capacity: 2`；`dealRules` 和数据结构已有预留。 |
| M9 LLM-agent | 实现 `PlayerAgent`、`agentDriver`、agent 讨论发言 / 出牌 / 提示决策、超时兜底、房主加 / 撤 agent。 | 未开始 | 后端已有类型和动作层预留，尚未接具体 agent。 |

### 后端当前重点

- 对 M0-M7 跑一次完整回归：`npm run typecheck`、`npm test`、关键 socket 流程。
- 在 Railway 上验证真实生产行为：Volume 路径、`progress.json` 保留、重启恢复、WebSocket 同步、`SIGTERM` flush。
- M8 开始前先明确是否继续维持“2 人 MVP 先验收完再放开 3/4 人”的节奏。

## 前端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | Vite + React + TS、tokens、字体、socket 单例、`useRoomStore`、`RoomView` 按 phase 切换。 | 已完成 | 前端项目、store、socket 基础已搭好。 |
| M1 登录 + 大厅 | Login、`player:join`、Lobby 座位 / 准备 / 房主徽标 / 设置面板 / 开始确认、接 `room:state`。 | 已完成 | 能进入房间并完成准备 / 房主流程；容量仍按 2 人 MVP 锁定。 |
| M2 选关 + 讨论 | LevelSelect 网格、已通关标记、规则说明、RulesPanel、聊天、讨论倒计时、房主提前开始。 | 基本完成 | 已改用真实关卡摘要；非房主只读语义和 `content-visibility` 已收口，待全量回归。 |
| M3 出牌核心 | 三栏布局、ClockBoard、HandRail、抢先手 / 交替态、回合倒计时、自由放置交互。 | 基本完成 | 区段 0/1-based 错位已修；S1/S6 出牌路径有 E2E 覆盖。 |
| M4 提示系统 | HintMarkers、HintPrompt 5 秒弹窗、暂停态、提示翻开牌展示。 | 基本完成 | focus trap、背景 `inert`、提示超时 E2E 已补；仍建议手动验收读屏与键盘体验。 |
| M5 揭示 + 结算 | Reveal 翻牌 / 总和 / 条件逐条亮灯；Result 成功 / 失败 / 复盘 / 房主按钮。 | 基本完成 | 结算二次确认、超时结果展示等已补；待完整端到端回归。 |
| M6 打磨 | 动效、`reduced-motion`、响应式、移动端 placing、连接 / 重连 / 离线三态、空 / 错 / 超长态、Playwright E2E。 | 基本完成 | review fixes 已大体落地，新增多条 E2E：重连禁操作、移动端布局、focus trap、skip link、Pill 键盘、隐藏牌防泄漏等。尚需跑全套验证。 |
| M7 上线验收与回归硬化 | 前端 build/typecheck/e2e 全绿；本地双开完整流程验收；Railway 页面和 Socket 行为验收；文档口径回写。 | 进行中 | E2E 基础已经建立，下一步应集中在全量跑测、修剩余回归和 Railway 手动验收。 |
| M8 3/4 人前端支持 | UI 放开 `capacity` 3/4；座位、TopBar、回合、手牌数量、可见性按 N 人派生；补多人 E2E。 | 未开始 | 需配合后端 M8；当前只保留结构预留，不应对外开放。 |
| M9 agent 前端支持 | agent 座位展示、agent 聊天消息样式、房主加 / 撤 agent 入口、agent 思考中状态。 | 未开始 | 需配合后端 M9；前端只展示服务端注入状态，不直接调用 LLM。 |

### 前端当前重点

- 跑全量验证并修回归：`npm run typecheck`、`npm run test:e2e -w @take-time/client`，必要时补 `npm test`。
- 用本地双浏览器完整走一局：登录、准备、选关、讨论、出牌、提示、揭示、结算、重试 / 返回选关。
- 对 review fixes 做人工 UI/a11y 验收：窄屏 placing、HintPrompt 焦点循环、非房主 LevelSelect、断线只读态、隐藏牌值不进 DOM。
- 验收通过后，把 [`plans/frontend-code-review-2026-06-16.md`](plans/frontend-code-review-2026-06-16.md) 中已解决项标记为已处理，或补一份完成记录。

## 关卡与内容

| 项目 | 当前状态 | 备注 |
| --- | --- | --- |
| 关卡目录结构 | 已完成 | `levels/` 已建立，一关一个 Markdown 文件。 |
| 前 4 关设计 | 已完成 | 已纳入 [`levels/README.md`](levels/README.md)。 |
| 规则权威来源 | 已完成 | [`rules.md`](rules.md) 是机制权威口径。 |
| 总关卡数 N | 待定 | 需要用户确认，例如 40 关或其他数量。 |
| 第 5 关及后续关卡 | 未开始 | 新增关卡后需同步更新索引，并跑求解器 / 条件展示 / 通关推进验证。 |

## 建议执行顺序

1. 先做一次全量本地回归：根目录 `npm run typecheck`、`npm test`、`npm run test:e2e -w @take-time/client`。
2. 修掉回归里暴露的前端 M6/M7 剩余问题，并做双浏览器人工验收。
3. 在 Railway 上验收 M7：页面加载、Socket 同步、Volume 进度保留、重启语义、`SIGTERM` flush。
4. 回写 review 文档，把已解决项和仍保留的取舍写清楚。
5. 再进入 M8：后端先放开 `capacity` 3/4 与测试，前端同步解除 UI 锁定并补多人 E2E。
6. 持续补关卡内容；每批关卡加入后跑求解器与核心流程回归。

