# AGENTS.md — 项目索引

> 本文件是给 AI agent 的项目导航目录。先读这里，了解项目在做什么、相关文件在哪、约定有哪些。所有回答都必须用中文回答

## 这个项目在做什么

**Take Time 单房间 2–4 人 Web 原型**：一个受 Libellud 合作桌游《Take Time》启发的、私用的在线合作时钟谜题游戏。

- 两名玩家（A / B）登录后进入唯一全局房间，各自准备；**第一个准备者为房主**，负责设置、选关、开始。
- 大厅流程：登录进房 → 准备（房主）→ 房主选关（已通关关卡标记显示）→ 进入该关 → 通关后按顺序推进。
- 核心循环：共同观察讨论 → 看牌后禁沟通 → 轮流暗置手牌（靠有限的"提示标记"传递信息）→ 揭示并校验 6 个区段的条件 → 成功/失败/重试。
- **已通关进度持久化**（Railway Volume + JSON），跨重启/重新登录保留。
- 部署目标：Railway 单服务（构建前端静态资源 + Express/Socket.IO 实时同步）。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Express + Socket.IO
- 运行时状态：服务端单进程内存对象（进行中的对局）
- 持久化：Railway Volume 上的 JSON/JSONL 文件（全局通关进度 + 设置、schema v2 账号、管理员账号审计）
- 部署：Railway 单实例，监听 `process.env.PORT`

## 当前开发进度

- M0–M7 主流程基本完成；M8 的 2–4 人弹性开局、固定 4 座位、按实际人数发牌、多人 UI、3/4 人 Socket 流程与多人 E2E 已落地，本地自动化回归已全绿，当前非 Agent 缺口主要是 Railway 与移动端真机验收。
- M9 的 M9.0–M9.2 代码框架已完成。2026-07-23 **M9.3 Slice 1–5 与目标 B 修订均已落地并完成独立复核**：候选/top-K、公开 Contract 与完整 DSL、策略摘要门禁、派生态 memory、review v2、`value-belief-v2` 和 2/3/4 人评测均已完成。旧 `reasonable-v2` 因仅审计首步且部分判定与被测策略同源，已被 `m9.3-reasonable-v3-independent` 取代；新闸门对 180 个配对 seed 的完整轨迹独立审计，合理落子 2160/2160、提示合理性 2160/2160、信念物理一致性 13108/13108、协调遵守 180/180，发布闸门通过。候选主路径仍默认关闭，等待本轮复核后重新签署；隐藏采样继续默认关闭。真实 Provider 历史 30 次重复中 turn top-K 30/30 合法、p95 2.748s、零超时/零 fallback。报告见 `evals/2026-07-23-m9-3-reasonable-v3-independent-report.json`、旧冻结报告和真实 Provider 报告。M9.4 完整 Socket 并发验收仍未签署，M9.5 持久化接口尚未实现。
- Agent 现行架构以 [docs/architecture.md](docs/architecture.md) 与 [docs/agent-memory-system-design.md](docs/agent-memory-system-design.md) 为准；剩余开发顺序以 [plans/2026-07-18-agent-remaining-development-plan.md](plans/2026-07-18-agent-remaining-development-plan.md) 为总纲，其中 **M9.3 以 [plans/2026-07-22-agent-gameplay-development-plan.md](plans/2026-07-22-agent-gameplay-development-plan.md) 为权威执行口径**（[codex 架构提案](plans/2026-07-22-agentic-gameplay-workflow-architecture-revision-plan.md) 为北极星，非现行架构），[plans/m9-agent-implementation-plan.md](plans/m9-agent-implementation-plan.md) 保留已完成里程碑与历史验收口径；旧 Claude/Anthropic 和唯一共享 `TeamStrategy` 实施表述均已废弃。
- ADR-0006 的“昵称+个人密码隐式注册”仅保留为历史迁移来源，现行账号身份以 ADR-0007 为准；Agent 长期关系记忆经评审推迟至 M9.5 之后，架构约束固化在 ADR-0006 决策二。
- 第一阶段邮箱账号方案按 [ADR-0007](docs/adr/0007-account-password-lifecycle-and-admin-management.md) 和 [邮箱身份详细设计](plans/2026-07-20-email-identity-recovery-and-admin-management-design.md) 推进：后端 schema v2、邮箱加密登录、显式注册、账号/座位双会话、玩家无座自助维护、`credentialVersion` 会话失效和管理员账号维护均已落地；生产 `/`、`/account/register`、`/account/security` 与 `/admin/*` 已接真实 Socket 并有本地自动化回归。**未验证邮箱只作为唯一登录标识**，昵称为可修改展示资料；注册不发验证码，当前不提供密码找回、恢复密钥、邮件 Provider、Resend 配置或旧账号升级 UI。管理员不能查看、代设、重置密码或代换邮箱。购买并验证自有域名后，邮箱验证与找回需另行立项，第一阶段账号不能自动视为已验证。
- 当前工作区存在 M8/M9 与移动端相关的未提交改动；修改时必须保留并避开无关用户改动。

## 文件目录

| 路径 | 作用 |
| --- | --- |
| [rules.md](rules.md) | **游戏规则总结**——游戏机制的权威口径，改机制先看这里。 |
| [docs/](docs/) | **产品 PRD / 规格文档**：产品总纲、路线图与后续规格说明。 |
| [docs/product-roadmap-prd.md](docs/product-roadmap-prd.md) | 产品总纲与 V1–V4 路线图：双人 MVP、3/4 人扩展、AI agent、AI 接管与全 agent 对局。 |
| [docs/architecture.md](docs/architecture.md) | **当前技术架构权威口径**：2–4 人、Agent、memory、Provider、持久化和部署边界。 |
| [docs/agent-memory-system-design.md](docs/agent-memory-system-design.md) | **Agent 记忆系统详细设计**：作用域、感知/实体/策略记忆、重试继承、持久化和验收。 |
| [docs/take-time-web-prototype.md](docs/take-time-web-prototype.md) | 历史双人 V1 设计基线；不再代表当前多人/Agent 架构。 |
| [docs/frontend-ui-plan.md](docs/frontend-ui-plan.md) | **前端开发唯一入口**：必读顺序、权威优先级、文件职责索引、功能到代码/测试导航，以及 UI、组件、响应式和里程碑。 |
| [docs/backend-dev-plan.md](docs/backend-dev-plan.md) | **后端开发唯一入口**：必读顺序、权威优先级、文件职责索引、功能到代码/测试导航，以及模块设计、Socket 矩阵、账号与会话不变式、部署。 |
| [docs/adr/](docs/adr/) | 重要架构决策记录：持久化、Agent 编排、隐藏信息候选评估、分层记忆与每座位策略。 |
| [plans/](plans/) | **尚未完成的执行计划**；完成或被替代的计划应标记状态并归档。 |
| [plans/2026-07-18-agent-remaining-development-plan.md](plans/2026-07-18-agent-remaining-development-plan.md) | Agent 剩余工作总计划：绿色基线、M9.3–M9.6、Provider 发布验收与产品收口；其中 **M9.3 执行口径已由下方对局开发方案细化并取代**。 |
| [plans/2026-07-22-agent-gameplay-development-plan.md](plans/2026-07-22-agent-gameplay-development-plan.md) | **M9.3 Slice 1 权威执行口径**：agentic workflow 定调 + 候选引擎/正向评分/结构化约定/LLM top-K 分片路线（含 codex review 的 fix 6/7 冻结）。 |
| [plans/2026-07-22-agentic-gameplay-workflow-architecture-revision-plan.md](plans/2026-07-22-agentic-gameplay-workflow-architecture-revision-plan.md) | Agent 对局的**目标架构（北极星）**：Observation→Claim→Contract、可执行 DSL、候选引擎、确定性复盘；codex 提案，非现行架构，不逐条施工。 |
| [plans/2026-07-21-agent-discussion-and-placement-findings.md](plans/2026-07-21-agent-discussion-and-placement-findings.md) | 讨论跟不上/出牌盲打的诊断与 P0/P1 修复记录，§8 出牌 token 预留漏洞（M9.3 工作的诊断源头）。 |
| [plans/2026-07-21-agreement-fulfillment-review-design.md](plans/2026-07-21-agreement-fulfillment-review-design.md) | 结果页「约定达标复盘」设计与实现记录（每条约定对照终局牌面判达标）。 |
| [plans/2026-07-20-email-identity-recovery-and-admin-management-design.md](plans/2026-07-20-email-identity-recovery-and-admin-management-design.md) | **现行账号安全设计**：未验证邮箱登录、直接注册、无找回限制、玩家资料维护与管理员后台。 |
| [plans/2026-07-20-account-security-and-admin-management-design.md](plans/2026-07-20-account-security-and-admin-management-design.md) | 已被邮箱身份方案替代的历史设计。 |
| [plans/m9-agent-implementation-plan.md](plans/m9-agent-implementation-plan.md) | M9.0–M9.2 已完成里程碑、真实 Provider 联调记录与原始阶段定义。 |
| [levels/](levels/) | **关卡设计**：一关一个 md 文件，按难度递进。 |
| [levels/README.md](levels/README.md) | 关卡索引 + 条件类型词汇 + 区段编号约定。 |
| [AGENTS.md](AGENTS.md) | 本索引文件。 |
| [CLAUDE.md](CLAUDE.md) | 引用本文件与关卡索引（`@AGENTS.md`、`@levels/README.md`）。 |

## 约定

- **产品级 PRD / 规格文档**统一放在 [docs/](docs/) 文件夹。
- **执行计划 / 设计文档**统一放在 [plans/](plans/) 文件夹。
- 所有前端任务在阅读本文件后统一进入 [docs/frontend-ui-plan.md](docs/frontend-ui-plan.md)，再按其中的功能导航读取详细设计、代码和测试；新增前端权威文件或核心页面时同步更新该入口。
- 所有后端任务在阅读本文件后统一进入 [docs/backend-dev-plan.md](docs/backend-dev-plan.md)，再按其中的功能导航读取详细设计、代码和测试；新增后端权威文件或核心模块时同步更新该入口。
- **当前架构**统一维护在 [docs/architecture.md](docs/architecture.md)；重要决策写入 [docs/adr/](docs/adr/)，不要把历史执行计划当成现行架构。
- **关卡设计**统一放在 [levels/](levels/) 文件夹，一关一个 md，按难度递进；新增关卡同步更新 [levels/README.md](levels/README.md) 的关卡列表。
- **游戏规则**以 [rules.md](rules.md) 为权威来源；[plans/](plans/) 里的设计需与之保持一致。
- 服务端是权威状态来源，负责所有关键校验；前端只展示状态和发送意图，不自行判定胜负。
- 手牌可见性与桌面暗牌的牌值（含颜色）由服务端按规则遮蔽后再下发。暗置在桌面上的牌数值不可见，但是颜色对所有玩家可见。
- **发牌前做可解性校验**：系统在抽出 12 张候选牌后，用求解器（`server/src/game/solver.ts`）验证该牌面在本关条件下至少存在一种解；无解则重抽，确保玩家永远拿到可通关的牌。

## 卡牌模型

- 牌库固定 **24 张**：白色 1–12（12 张）+ 黑色 1–12（12 张）。
- 每局随机抽 **12 张**，2 人各得 6 张；关卡不再各自携带 `deck`，见 `server/src/game/deal.ts`。
- 卡牌带 `value`（数值）和 `color`（`'white' | 'black'`）两个维度；手牌按人数规则遮蔽。桌面暗牌的**颜色公开、数值遮蔽**，提示翻开或最终揭示时公开数值。

## 待补全项（影响实现，需用户提供）

- 关卡内容：**总关卡数 N（如 40）**；前 4 关已设计于 [levels/](levels/)，后续关卡持续补充。
