# AGENTS.md — 项目索引

> 本文件是给 AI agent 的项目导航目录。先读这里，了解项目在做什么、相关文件在哪、约定有哪些。所有回答都必须用中文回答

## 这个项目在做什么

**Take Time 单房间双人 Web 原型**：一个受 Libellud 合作桌游《Take Time》启发的、私用的在线合作时钟谜题游戏。

- 两名玩家（A / B）登录后进入唯一全局房间，各自准备；**第一个准备者为房主**，负责设置、选关、开始。
- 大厅流程：登录进房 → 准备（房主）→ 房主选关（已通关关卡标记显示）→ 进入该关 → 通关后按顺序推进。
- 核心循环：共同观察讨论 → 看牌后禁沟通 → 轮流暗置手牌（靠有限的"提示标记"传递信息）→ 揭示并校验 6 个区段的条件 → 成功/失败/重试。
- **已通关进度持久化**（Railway Volume + JSON），跨重启/重新登录保留。
- 部署目标：Railway 单服务（构建前端静态资源 + Express/Socket.IO 实时同步）。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Express + Socket.IO
- 运行时状态：服务端单进程内存对象（进行中的对局）
- 进度持久化：Railway Volume 上的 JSON 文件（仅存已通关进度 + 设置）
- 部署：Railway 单实例，监听 `process.env.PORT`

## 当前开发进度

- 后端：MVP M0–M7 基本完成，已处理 `backend-review-followups.md` 中的后端 review follow-ups；当前处于可开始 M8（3/4 人 `capacity` 放开与测试）的节点，M8 尚未正式实现。
- 前端：核心联调界面已推进到可对接后端主流程的阶段，但 `frontend-code-review-2026-06-16.md` 中记录的 UI/交互/a11y 收口问题仍待修复；前端不是 M8 阶段，下一步应优先处理这些 review fixes。

## 文件目录

| 路径 | 作用 |
| --- | --- |
| [rules.md](rules.md) | **游戏规则总结**——游戏机制的权威口径，改机制先看这里。 |
| [docs/](docs/) | **产品 PRD / 规格文档**：产品总纲、路线图与后续规格说明。 |
| [docs/product-roadmap-prd.md](docs/product-roadmap-prd.md) | 产品总纲与 V1–V4 路线图：双人 MVP、3/4 人扩展、AI agent、AI 接管与全 agent 对局。 |
| [plans/](plans/) | **所有执行计划 / 设计方案**都放这里。 |
| [plans/take-time-web-prototype.md](plans/take-time-web-prototype.md) | 当前设计方案：状态机、数据模型、Socket 事件、服务端校验、测试计划。 |
| [plans/frontend-ui-plan.md](plans/frontend-ui-plan.md) | 前端开发计划 & UI 规划：美术方向、界面地图、组件架构、可访问性合规、里程碑。 |
| [plans/backend-dev-plan.md](plans/backend-dev-plan.md) | 后端开发计划：仓库结构、核心模块、Socket 实现矩阵、测试/部署、里程碑。 |
| [levels/](levels/) | **关卡设计**：一关一个 md 文件，按难度递进。 |
| [levels/README.md](levels/README.md) | 关卡索引 + 条件类型词汇 + 区段编号约定。 |
| [AGENTS.md](AGENTS.md) | 本索引文件。 |
| [CLAUDE.md](CLAUDE.md) | 引用本文件与关卡索引（`@AGENTS.md`、`@levels/README.md`）。 |

## 约定

- **产品级 PRD / 规格文档**统一放在 [docs/](docs/) 文件夹。
- **执行计划 / 设计文档**统一放在 [plans/](plans/) 文件夹。
- **关卡设计**统一放在 [levels/](levels/) 文件夹，一关一个 md，按难度递进；新增关卡同步更新 [levels/README.md](levels/README.md) 的关卡列表。
- **游戏规则**以 [rules.md](rules.md) 为权威来源；[plans/](plans/) 里的设计需与之保持一致。
- 服务端是权威状态来源，负责所有关键校验；前端只展示状态和发送意图，不自行判定胜负。
- 手牌可见性与桌面暗牌的牌值（含颜色）由服务端按规则遮蔽后再下发。暗置在桌面上的牌数值不可见，但是颜色对所有玩家可见。
- **发牌前做可解性校验**：系统在抽出 12 张候选牌后，用求解器（`server/src/game/solver.ts`）验证该牌面在本关条件下至少存在一种解；无解则重抽，确保玩家永远拿到可通关的牌。

## 卡牌模型

- 牌库固定 **24 张**：白色 1–12（12 张）+ 黑色 1–12（12 张）。
- 每局随机抽 **12 张**，2 人各得 6 张；关卡不再各自携带 `deck`，见 `server/src/game/deal.ts`。
- 卡牌带 `value`（数值）和 `color`（`'white' | 'black'`）两个维度；暗置阶段两者一并遮蔽，揭示时公开。

## 待补全项（影响实现，需用户提供）

- 关卡内容：**总关卡数 N（如 40）**；前 4 关已设计于 [levels/](levels/)，后续关卡持续补充。
