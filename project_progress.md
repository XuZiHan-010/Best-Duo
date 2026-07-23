# Project Progress

> 更新时间：2026-07-23（含 M9.3 Slice 1–5、目标 B 修订、独立完整轨迹复核与四项审查问题修复）
> 口径：记录**当前本地工作区**的开发完成度与下一步优先级；M8、M9 框架、本轮移动端视口修复和文档调整尚未全部进入当前 Git HEAD。更细的设计与执行细节见 [`docs/`](docs/) 与 [`plans/`](plans/)。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| 已完成 | 主功能已落地，并已有基本验证或可联调用例。 |
| 基本完成 | 主流程可用，代码层面已落地，但仍需要全量测试、人工验收、Railway 验收或文档回写。 |
| 进行中 | 已有部分实现，尚未达到该里程碑验收口径。 |
| 未开始 | 尚未正式实现。 |
| 待定 | 依赖用户补充内容或范围确认。 |

## 最近验证快照（2026-07-23，M9.3 独立复核后）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 全仓 typecheck | 通过 | `npm.cmd run typecheck`：shared build 及 client/server/shared TypeScript 检查全部通过。 |
| 服务端测试 | 通过 | `npm.cmd test -w @take-time/server`：57 个测试文件、410 项测试全部通过。 |
| M9.3 独立发布评测 | 通过 | `m9.3-reasonable-v3-independent` 正式运行 180 个配对 seed：合理落子 2160/2160、提示合理性 2160/2160、信念物理一致性 13108/13108、协调遵守 180/180；`releaseGatePass=true`。 |
| M9.3 真实 Provider 历史验收 | 通过 | turn top-K 30/30 合法，p95 2.748s，零超时、零 fallback；本轮四项后端修订未重新产生 Provider 费用复跑。 |
| 全量构建 / Playwright | 最近历史轮次通过 | 账号、多人、移动端与 Agent 混合流程已有本地自动化回归；2026-07-23 的最后一批 M9.3 后端修订运行了全仓 typecheck 与服务端全量测试，未重新运行 build/Playwright。 |
| Railway 生产验收 | 待运行 | Volume 上的 `progress.json` 跨重启保留、WebSocket、`SIGTERM` flush 仍需真实环境验证；进行中对局重启后按设计清空，不做恢复。 |
| 真机验收 | 待运行 | iOS Safari / Android Chrome 上的横竖屏切换、地址栏伸缩、安全区、软键盘等仍需真机验证（见方案 §10 矩阵）。 |

> 注意：上述结果证明当前本地工作区的构建与服务端测试健康；它不代表尚未提交的改动已经进入远端仓库或 Railway 部署版本。

## 玩家身份安全与管理员强制接管（2026-07-16，已完成）

按 [plans/2026-07-15-player-identity-and-admin-control-plan.md](plans/2026-07-15-player-identity-and-admin-control-plan.md) 全部 8 个任务落地（决策见 [ADR-0005](docs/adr/0005-player-identity-and-admin-seize.md)）：

- 服务端签发 `playerId + reconnectToken`（SHA-256 摘要存储、30s 轮换宽限期）取代"同昵称+房间密码=重连"，封死抢座漏洞；`PublicSeat` 显式白名单防凭证泄漏。
- 客户端会话存 `sessionStorage`，handshake `auth` 自动恢复座位；`?nick=` URL 凭证机制整体拆除。
- 管理员 `/admin` 独立入口（`ADMIN_USERNAME`/`ADMIN_PASSWORD`，恒定时间比较+限流）：登录经确认弹窗后原子接管——终止对局、全员请出（终态全屏提示）、撤销全部会话、管理员入 A 座为房主；在座期间可单点请出（`stateVersion` 防陈旧操作）。
- 验证：服务端 31 文件 / 231 项测试全绿；Playwright 35/35 全绿（新增 admin-seize 2 项、reconnect 会话场景 2 项）；E2E 改为确定性（globalSetup 置空模型 key）。

## 总览

当前项目是单房间 2–4 人 Web 原型。后端 MVP M0-M6 已完成，M7 的代码侧 review follow-ups 与本地全量自动化回归已完成，剩余 Railway 生产验收。M8 弹性扩容后端、前端与自动化测试已经落地：固定 4 座、弹性开始校验、按实际人数发牌、多人 UI、3/4 人完整 Socket 对局和完整 Playwright 对局均已验证；仍需多人真机与 Railway 人工验收。M9.0–M9.3 已完成领域框架、讨论与每座位策略、真实模型接入、候选/top-K、公开 Contract、完整 DSL、派生态 memory、review v2、`value-belief-v2` 与 2/3/4 人独立评测；下一项是 M9.4 完整 Socket 并发验收，之后进入 M9.5 repository/finalizer 边界和 M9.6 通用离线评测。

前端核心联调界面已推进到可完整承接服务端主流程的阶段。本轮前端 review fixes 已经大量落地：重连/离线禁操作、移动端 placing 布局、HintPrompt focus trap、LevelSelect 只读语义、Pill 方向键、skip link、聊天 input `name`、倒计时 `requestAnimationFrame`、隐藏牌 DOM 泄漏检测、选段错位修复等都有对应实现和 Playwright E2E 用例。

**2026-06-17 更新汇总**：揭示（Reveal）阶段现在暂停等待房主手动确认后再进入结算，移除了原来的自动推进计时器；新增 `game:continueToResult` 服务端事件、客户端 socket adapter 对应封装，以及 Reveal 视图中房主专属“继续”按钮。同日还完成了 README 双语部署说明、Railway 构建链路修复、文档目录口径从 `plans/` 迁移到 `docs/`、规则/PRD/技术方案同步、Level 02 条件微调，以及隐藏牌可见性、出牌动作校验和 socket 流程测试补强。下一步重点从“补代码”转为“全量验收与回归”。

**2026-06-18 更新汇总**：Level 05–10 已补齐 Markdown 设计稿并同步到运行时关卡数据，`levels/README.md`、AGENTS 索引和相关 PRD/技术文档已同步更新。条件体系新增 `min-color-cards` 与 `has-duplicate-value`，并补齐 shared 类型、后端条件引擎、求解器、前端条件文案 / 区段提示和单测覆盖；发牌前可解性校验已能识别这些新条件。为方便本地测试，非生产服务端允许房主选择所有关卡，前端在本地地址也展示全部关卡可选；production 仍保留原顺序解锁逻辑，并新增 socket 回归测试保护线上行为。已验证 `npm.cmd run test -w @take-time/server`、`npm.cmd run typecheck -w @take-time/client`、`npm.cmd run typecheck -w @take-time/server` 通过。

**2026-06-19 更新汇总**：补强了 `room:state` 同步可靠性：shared 状态新增 `stateVersion` 与 `shouldAcceptRoomState`，服务端每次广播 / 单 socket 同步时推进版本号，客户端拒绝旧版本状态，并在重连或页面重新可见时主动发送 `room:sync` 拉取最新状态；同时补了服务端版本递增单测和前端 Playwright 状态同步回归，覆盖队友离线后重新连接仍能看到最新 pending hint 的场景。前端继续收口 placing / reveal / result 的移动端体验与提示可读性，包括 TopBar 安全区、Reveal/Result 窄屏纵向布局、时钟区段提示与幽灵卡堆错开、提示等待文案和符号调整。关卡内容也做了新一轮整理：原 5-12 关顺序重排，新增 Level 07“七八九禁区”和 Level 13“双锚点”，并同步 `levels/README.md`、各关 Markdown、运行时 `server/src/levels/data.ts` 与 loader 单测。

**2026-06-24 更新汇总（M8/M9 开发）**：M8 弹性扩容后端已完成：`createSeats` 固定传 4、`capacity` 从 `2` 改为 `4`、`settingsUpdateSchema` 移除 capacity 字段、新增 `canStartGame`/`occupiedSeats`/`humanSeats` 辅助函数、`deal.ts` 按实际落座人数路由 `dealRules`、shared 新增 `handSizeForPlayerCount`。M8 前端也已同步完成：`selectors.ts` 新增 `teammateSeatsSelector`/`occupiedCountSelector`/`allReadySelector`，`canStartSelector` 对齐后端逻辑，`Placing.tsx` 改用 `teammates.map` 渲染多队友（含 AI 思考中文案），`SettingsPanel` 移除人数选项改为只读说明，`Lobby` 渲染全部 4 个座位并支持添加/移除 AI。M9 后端框架已完成：`HostAddAgent`/`HostRemoveAgent` handler、`InMemoryAgentRegistry`、`scriptedAgent`（占位）、`agentDriver`、`handoff.ts` Agent 出牌/hint 接入循环。M9 前端也已就绪：Lobby AI 添加/移除 UI、Placing AI 状态文案、Agent 消息样式和 adapter。该时间点真实 LLM 与讨论调用尚未实现；当时拟用的 Claude 路线已被 2026-07-13 新架构替代。**2026-06-25 bug 修复**：`handoff.ts` while 循环 Agent placement 后缺少 `afterRevealIfNeeded` 调用已修复。

**2026-07-13 架构收口**：新增 `docs/architecture.md`、3 份 ADR 与 `plans/m9-agent-implementation-plan.md`。废弃 Claude/Anthropic 单模型路线、单一 `AgentRoomView`、独立 hint LLM 调用和仅靠 `Promise.race` 的超时方案。M9 改为：讨论/策略与实时出牌分任务路由；每个 attempt 隔离团队策略和私人 memory；placement 与 hint 合并；请求使用 `AbortController`；候选评分不得读取真实隐藏牌。面试版本持久化目标调整为 PostgreSQL 保存进度、attempt、策略和 Agent telemetry，实时对局仍在内存。

**2026-07-14 Agent 记忆架构收口**：新增 `docs/agent-memory-system-design.md` 与 ADR-0004。记忆作用域主干为 Campaign → LevelRun → Attempt 三级，PlaySession 为与 LevelRun 正交的运行期作用域（承载跨关软偏好）；M9 实现感知、实体、信念、行动、承诺和每座位独立 `SeatStrategy`，同关 retry 只继承公开 `RetryBrief`；M10 持久化 `LevelRunMemory`，支持失败退出后再回来恢复同关公开经验。唯一共享 `TeamStrategy` 方案废弃，公开讨论共享但每个 Agent 的私人理解和计划隔离。

**2026-07-13 移动端视口修复实施（按 `plans/2026-07-10-mobile-gameplay-viewport-fixes.md`）**：落地了讨论/出牌阶段的手机竖屏、短横屏与旋转修复。
- **单一滚动模型**：`.room-view__main` 成为唯一页面级纵向滚动容器（`overflow-y:auto` + `overscroll-behavior` + `dvh` 外壳）；移除出牌页 `overflow:hidden` 与 Reveal 的内部 `overflow-y:auto`，各阶段视图改为自然高度（`flex:0 0 auto; min-height:100%`）。
- **响应式分层**：把原 `≤767px` 媒体块按“方向无关 / 竖屏专属 / 短横屏（`orientation:landscape and max-height:600px`）”三类拆分；出牌页短横屏改用 grid 双区布局，转盘按宽高双约束缩放不再硬塞一屏。
- **HintPrompt 遮罩**改为 `position:fixed`，避免长页面滚动后带倒计时的提示弹窗定位到视口外。
- **等待态样式**：`Discussion.tsx` 的非房主/断线提示从 `.view-stub`（`flex:1`）改为专用 `.discussion__status`（`role=status`、不 `flex-grow`），不再吞高度、遮挡转盘。
- **index.html** 补 `viewport-fit=cover`；相关安全区 `env(safe-area-inset-*)` 生效。
- **E2E**：新增 `mobile-discussion-orientation.spec.ts` 并重写 `mobile-placing-layout.spec.ts`（删除过时的 `no-scroll` 契约，改测无重叠/可滚动到达/旋转重排/弹窗可见）；`helpers.ts` 支持向 `browser.newContext()` 传 viewport 并新增讨论/reveal 阶段 setup。
- **顺带修复的预存缺陷**：① 进入出牌阶段必崩的 React #185——`teammateSeatsSelector` 每次返回新数组导致 zustand 无限重渲染，改用 `useShallow` 包裹；② “同昵称重连被锁至旧连接 ping 超时”——`room:reset` 现会切断其它遗留连接，`player:join` 遇同昵称+正确密码改为踢旧连接接管席位（并改写对应服务端单测）；③ 修正 `reconnect`/`hint-timeout` 两个用例中与现源码漂移的过时断言字符串（`已准备 ✓`、`◉ 轮到你出牌`、`等待准备…`）。

**2026-07-13 多人自动化收口**：服务端新增 3/4 真人完整成功局，以及 1 真人 + 1/3 脚本 Agent、2 真人 + 1 Agent 的完整 Socket 对局，服务端回归增至 79/79。Playwright 新增 3/4 真人、上述三种脚本 Agent 混合阵容从大厅到结算的完整流程，并覆盖 4 真人手机视口布局；统一自动夹具会在每个用例后关闭手工创建的 browser context，消除了单全局房间的串行污染。E2E 测试服务改由 global setup 直接持有 Node 子进程，标准 `npm run test:e2e` 可正常退出，最新全量为 31/31。

**2026-07-15 更新汇总（M9.2 模型接入 + 代码审查修复）**：M9.2 代码框架（OpenAI/DeepSeek adapter、按任务 env 路由、单次 `TurnDecision`、deadline/Abort、调用与 token 预算、六项指标 telemetry、Provider 契约评测）落地后，对照 M9 实施计划做了一轮完整代码审查，产出 [`plans/2026-07-15-m9-2-code-review-findings.md`](plans/2026-07-15-m9-2-code-review-findings.md)，共 8 项问题（M92-001~008，4 高 4 中）；经逐条对照源码核实全部属实（策略收口缺 system prompt/deadline/Abort、TurnView 未注入锁定策略与私人 memory、`retry_brief` 无生产调用方、主动取消误记 timeout、telemetry 口径缺口、预算非硬上限、任务级 Provider 配置与契约评测未闭环、验收矩阵不完整）。当日修复已全部落地：① 策略收口与讨论请求补齐 system prompt、独立 deadline 与 `AbortSignal`；② `buildTurnView` 注入本座位锁定 `SeatStrategy` 与私人 memory，applied/relaxed 规则 ID 可追溯校验；③ 结果阶段接入 `retry_brief` 模型调用，失败/超时/预算超限时保留确定性摘要降级；④ 新增 `modelAbortReason` 区分 deadline 与主动取消，主动取消不再污染 `deadlineMissRate`；⑤ telemetry 事件补 `levelId`/`playerCount` 并支持按关卡×人数分组统计；⑥ 预算改为按 attemptId 记账 + 发起前预留调用/token 额度，请求带单次 max output tokens，attempt 切换不再串账；⑦ 新增 `agentlab:provider-contract` 可执行契约评测命令；⑧ 补齐验收矩阵测试，服务端回归自 186 项增至 **203/203**（28 文件，本机复跑确认），typecheck 全绿。真实模型联调仍待根目录 `.env` 填入 API key。

**2026-07-18 玩家账号体系落地（ADR-0006 决策一）**：codex 对《玩家账号与 Agent 长期画像记忆计划》的评审经逐条对照代码核实后采纳，结论拆为两半——账号体系本轮实施，Agent 长期记忆定向推迟。新增 [ADR-0006](docs/adr/0006-player-accounts-and-deferred-agent-memory.md)，原计划就地修订为 v2（Phase A only），评审文档标记为已采纳。

- **账户存储** `server/src/auth/accountStore.ts`：昵称+个人密码隐式注册，持久 `playerId`；口令只存**异步** `crypto.scrypt` 摘要（原计划的 `scryptSync` 会阻塞与游戏定时器同进程的事件循环），KDF 参数（N/r/p/keylen）随记录版本化以便将来提升成本参数；`accounts.json` 损坏时 **fail-closed**——拒绝一切注册与密码登录（`ACCOUNT_STORE_UNAVAILABLE`）、`persist()` 拒绝执行、写前留 `.bak`。原计划的"回退空仓库"被否决：那等于允许旧昵称被新密码重新注册，是身份接管漏洞。
- **join 协议双分支**：`playerJoinSchema` 由单一 object 改为 union——会话分支（凭 `session`，免房间密码与个人密码，兼容现网 payload 并忽略多余字段）与账号分支（房间密码 + 4–64 位个人密码）。原计划把 `accountPassword` 设为必填会拒掉带会话凭证的自动重连。`shared/src/events.ts` 的 `PlayerJoinPayload` 同步为可辨识联合。
- **join 流程接入账号**：处理顺序为 schema → 有 session 走原会话路径（不触账户库）→ 房间密码门槛（失败不触账户库、不计账号限流，探测不到昵称是否已注册）→ 账号限流 → **先判可入座性再触达账户库**（房满/对局中不产生注册副作用，杜绝幽灵账户）→ 异步验密/注册 → 接管或入座。正确密码接管在线座位复用 ADR-0005 顺序（先附着、换发会话、最后断旧 socket），且**直接换发而非轮换**，旧令牌立即作废，防止旧端在 30s 宽限期内抢回座位；管理员座位不可被账号密码接管（否则可用未注册的管理员昵称注册新账号劫持座位）；同昵称 Agent 座位维持 `NICK_IN_USE`。`PlayerSessionStore.issue` 改为接受外部 `playerId`，新增 `isAdminSeat`；账号限流 `server/src/auth/accountRateLimit.ts` 按昵称维度包装复用 `adminAuth.ts` 的 `FailureRateLimiter`（60s 窗口 5 次）。
- **新增稳定错误码**：`ACCOUNT_PASSWORD_MISMATCH`、`ACCOUNT_RATE_LIMITED`、`ACCOUNT_STORE_UNAVAILABLE`；`NICK_IN_USE` 收窄为 Agent 昵称冲突等剩余场景。
- **前端**：登录页新增"个人密码"字段（首次输入即注册）与"昵称与头像注册后不可修改"说明；自动重连仍走 handshake `auth` 会话分支，不要求个人密码。
- **测试**：新增 `accountStore.test.ts`（6 项，含 fail-closed 不覆盖原文件）、`schemas.test.ts`（5 项双分支）、`socketFlow` 账号场景 6 项（注册后 playerId 稳定、密码接管、头像固定、房间密码错误不触发注册、限流、账户损坏拒绝注册）；E2E 新增 `accounts.spec.ts` 4 场景，并把 reconnect 的"重复昵称被拒"改写为"错误密码不能接管"的新语义；`globalSetup` 每次自管启动前清空 `.tmp-e2e-data/accounts.json` 保证登录场景确定性。
- **验证**：根目录 typecheck 全绿、服务端 **278/278**（37 文件）、Playwright **39/39** 全绿。
- **同步推迟决议**：ADR-0006 决策二明确 Agent 长期关系记忆推迟至 M9.5 repository 边界落地后，届时按三层结构（`PlayerBehaviorFacts` 系统确定性事实 / `AgentIdentity` 稳定身份 / `AgentRelationshipMemory` 单个 AI 的私有关系记忆）实施，硬约束为：座位级临时 `agentId` 必须关联持久 `agentProfileId`（现行 `HostAddAgent` 每次 `randomUUID()`，移除再添加即"另一个 AI"）、证据只用当时公开可见且带作者标识的 observation、模型只输出 delta 并由服务端按 `(agentProfileId, playerId)` 串行 + revision CAS 提交。原计划的"共享 `profiles.json` 画像注入所有 Agent"方案**已废弃**（与"每个 AI 像真人牌搭子一样形成自己的记忆"的产品共识不符），`profileStore`、`profile_update` 模型任务、画像注入视图本轮均未实现。

**2026-07-19 Agent 计划复核与缺陷修复**：对照当前剩余计划检查 M9 实现，确认 M9.3、M9.5–M9.7 仍未完成，M9.4 仅主体代码落地、正式并发验收未签署。本轮修复：① race 延迟失败者在赢家落子后仍启动 Provider 请求；② `TurnCoordinator` 发起模型前缺少座位资格检查；③ cancelled 事件稀释 deadline/fallback 率分母；④ Provider 失败/取消把 token 成本错误结算为 0；⑤ Provider 契约报告缺 fallback、token、冷启动/连续调用和策略收口 case；⑥ 混合 Agent E2E 依赖瞬时牌数并存在选牌/抢先手竞态；⑦ Playwright global teardown 在 Windows 上会把失败进程退出码改成 0；⑧ 超时渲染用例仍按旧 5 秒回合等待。修复后根目录 typecheck、build、服务端 278/278（37 文件）、Provider contract mock 15/15、Playwright 39/39 全绿；真实 Provider 批量验收因会产生 API 费用未执行。

**2026-07-20 第一阶段邮箱身份账号方案（ADR-0007 已接受）**：账号模型从 ADR-0006 的"昵称 + 个人密码隐式注册"切换为"邮箱 + 个人密码显式注册 / 登录"。新增 [ADR-0007](docs/adr/0007-account-password-lifecycle-and-admin-management.md)（已接受）与[邮箱身份详细设计](plans/2026-07-20-email-identity-recovery-and-admin-management-design.md)，替代同日的 [account-security 历史设计](plans/2026-07-20-account-security-and-admin-management-design.md)。

- **安全边界（决策一~五）**：**未验证邮箱只作为唯一登录标识**——只校验格式与唯一性，不证明邮箱所有权，产品文案不得称其"已验证 / 已绑定 / 可找回"；昵称为可修改、账号级唯一（`nicknameNormalized`）的展示资料，内部身份始终用稳定 `playerId`。第一阶段明确**不做**：邮箱验证码 / 验证状态、`/account/recover` 与"忘记密码"入口、恢复密钥、管理员代设或重置密码、管理员代换邮箱，以及 Resend / SMTP / 发信域名与相关 env。忘记密码即永久失去账号，登录 / 注册页各展示一句同时点明"不验证邮箱 + 无法找回密码"的提示。
- **账户存储 schema v2（`accountStore.ts`）**：邮箱规范化后加密存储作为登录标识、密码走异步 `scrypt` 哈希、`nicknameNormalized` 唯一索引、`credentialVersion`、账号状态（`active` / `disabled` / `deleted` 软删除）、`nicknameChangedAt` 等字段；沿用 fail-closed 与写前 `.bak`。管理员账号维护动作写 JSONL 审计。
- **Socket / schema（`schemas.ts`、`registerHandlers.ts`）**：新增账号显式注册 / 登录、玩家自助改昵称（`accountProfileUpdate`）、改密码（`accountPasswordChange`）、改邮箱（`accountEmailChange`）、撤销其他会话（`accountSessionsRevokeOthers`），以及管理员 `adminAccountsList` / `ForceLogout` / `SetStatus` / `SoftDelete`。登录仍**先校验房间密码再触账户库**（房间密码充当廉价前置闸门，避免任意邮箱触发 `scrypt` 放大攻击）；账号相关失败统一为"邮箱或密码不正确"防枚举，房间密码错误使用独立文案。
- **`credentialVersion` 会话失效**：改密 / 改邮成功后递增版本，其他会话据此自动失效，当前设备立即换发携带新版本的会话且不中断进行中的对局。
- **管理员边界（决策三）**：不能查看、导出、代设、重置密码或代换邮箱、标记邮箱已验证；可强制登出、停用 / 恢复、软删除账号，以及在房间页请出玩家（只释放座位，不改变注册账号状态）。
- **前端**：生产 `/`、`/account/register`、`/account/security`、`/admin/accounts` 与 `/admin/room` 均已接入真实 Socket、会话和错误状态；管理员后台认证不占座，进入房间是独立显式动作。
- **验证（2026-07-20 本机）**：根目录 `npm run typecheck`（shared build + client/server/shared tsc）全绿；服务端 `npm.cmd run test -w @take-time/server` **40 文件 / 323 项全绿**（较上一版 278/278 新增 45 项，含 `accountAdminSocket`、`accountRateLimit` 与 `socketFlow` / `schemas` 账号维护用例）；新增 `client/e2e/email-account-prototype.spec.ts`（6 项）本轮未运行。

**2026-07-21 Agent 讨论/出牌诊断修复（P0/P1）**：真人 + 1 AI 实测 level-01，AI 讨论时"没听进"人类数值方案、出牌违反非递减通用规则失败。经运行期日志 + 源码走查定位为三个工程机制问题并按 TDD 全部修复，详见 [plans/2026-07-21-agent-discussion-and-placement-findings.md](plans/2026-07-21-agent-discussion-and-placement-findings.md)：① 讨论发言硬上限 3 次导致 AI 中途永久沉默（改 `Infinity`，`spokenCounts` 仅遥测）；② discussion→placing 转换无房间级单飞，并发收口互相取消策略、出牌整阶段零策略盲打（`registerHandlers` 按 `room+attemptId` 建唯一 transition Promise、仅 owner 推进、`strategyDeadlineMs` 8s、前端"正在整理讨论策略"）；③ 策略收口失败锁空策略伪装成功（新增 `strategyFallback` 从公开事实派生兜底 + `strategySource`/`compileOutcome` 诚实标注）；④ 出牌无护栏（`safePolicy` 严格化非递减剪枝、`isPlacementProvablyLosing` 对模型正常返回也过一遍可证必输过滤）；⑤ 分桶预算（`budget.beginAttempt` 接受 `reservedTurnCalls` 给出牌预留）；⑥ 真人连发消息 supersede 合并到最新上下文只调一次；⑦ TurnView 补只含公开信息的 `segmentKnowledge`。服务端全量自 40/323 增至 **47 文件 / 347 项全绿**。

**2026-07-21 出牌 token 预留漏洞修复（§8 追加）**：真人 + 1 AI 复现"出牌到一半（3/6）开始 `budget_exceeded` 兜底盲打"。实测确认 OpenAI/DeepSeek key、模型（`gpt-5.4`/`gpt-5.4-mini`/`deepseek-v4-flash`）、chat 接口与参数均正常（turn 调用 3969ms、discussion 1843ms，均在 deadline 内），排除凭证/模型/接口问题；根因是**上一条 P1-1b 的 turn 预留只挡"调用次数"不挡"token"**——讨论去掉发言上限后把 attempt 的 `attemptMaxTokens`（默认 20 万）聊穿，出牌即使有预留的调用次数也撞 token 上限盲打。修复：`budget.ts` 的 `ModelCallBudget` 新增 `turnTokenReserveRemaining`（非 turn 任务扣除该预留、turn 优先消耗，与既有次数预留对称）；`runtime.onDiscussionStarted` 传 `reservedTurnTokens = reservedTurnCalls × maxOutputTokensFor("turn") × 2`，并给次数预留加 `TURN_RETRY_HEADROOM=2`（L1 每张牌最坏 2 次调用冗余）；`AgentPublicSummary.tsx` 给 `budget_exceeded` 补专属文案（此前落到无前缀通用文案、易误读为"调用失败"）。TDD 先写 2 项失败测试（`modelBudget.test.ts`）验证 RED 后实现。验证：根目录 typecheck 全绿、构建通过、服务端全量 **47 文件 / 349 项全绿**（较上一版 347 新增 2 项）、预算/出牌相邻用例重复 2 次稳定。未做：讨论限流（Layer B，出牌既被严格保护，讨论多花预算只会更早闭嘴，危害小于盲打）、`budget_exceeded` 的 calls/tokens 维度细分日志。

**2026-07-22 约定达标复盘（Agreement Fulfillment Review）**：结果页「AI 队友协作复盘」原来只列出 AI 锁定的协作约定名与一句粗教训，看不出每条约定针对的区段最终有没有达标。按 [设计文档](plans/2026-07-21-agreement-fulfillment-review-design.md)（brainstorming 确认口径后 TDD 落地）新增该能力。诚实口径为"**该约定针对的区段是否达标**"，而非"AI 是否守约"——`custom` 规则的自由文本无法机器校验，只能用确定性可拿到的终局牌面 + 条件结果逼近。实现为**纯前端投影 + 一个可复用纯函数**，零服务端权威改动、不依赖 M9.3：① `shared/src/agreementFulfillment.ts` 新增 `evaluateAgreementFulfillment(rule, placements, revealResult)`，对每个目标区段折叠终局构成（张数/黑白/总和）、收集该区段专属条件的通过情况得出 `met`，跨区段规则（非递减/非递增/相邻差）失败只记入 `spanningIssues` 不翻转 `met`，无目标区段返回 `no-target`；② `AgentPublicSummary` 增加可选 `reveal` prop，结算时把每条约定展开为"终局构成 vs 要求 + ✓/✗"，复用 client 的 `conditionToText` 渲染，Placing 的 compact 用法行为不变；③ `Result.tsx` 传入 `reveal`。TDD 先写 7 项失败测试（`server/tests/agreementFulfillment.test.ts`，借 server vitest 从 `@take-time/shared` 导入）验证 RED 后实现。验证：根目录 typecheck 全绿、build 通过、服务端全量 **48 文件 / 356 项全绿**（较上一版 47/349 新增该测试文件 7 项）；客户端渲染无单元 runner，靠 typecheck/build 兜底，视觉/交互待人工在结果页确认。

**2026-07-22 M9.3 Slice 1 继续（候选回合主链接线）**：在既有 `server/src/agent/candidates/` 候选生成/正向评分之上完成 `turnCoordinator` 接线：每回合只生成一次候选，top-K 注入 prompt 并在 orchestrator 侧硬校验；榜外输出、超时、预算、熔断和 Provider 错误统一回落同一候选 #1，非模型路径 `revealIntent=no`；支持可配置置信分差跳过 Provider和纯 `candidate-top1` 基线；硬 `avoid_segment` 与唯一合法动作冲突时恢复候选并记录 `relaxedRuleIds`。telemetry 新增 `selectionSource`、`candidateSetHash`、`evaluatorVersion`、`hintDecisionSource`，prompt 升至 `m9.3-v3`。`AGENT_CANDIDATE_ENGINE_V1` 默认关闭，等待配对 eval 决定生产默认。**Slice 1 剩余**：策略收口产出/讨论内摘要与真人确认、双套件配对 eval 和发布默认签署。

**2026-07-23 M9.3 Slice 1–5 与目标 B 独立复核完成**：公开 `PublicCoordinationContract` 与完整可执行 DSL、讨论策略摘要门禁、候选/top-K、派生态 memory、review v2、`value-belief-v2`、2/3/4 人冻结评测均已落地。复核发现旧 `m9.3-reasonable-v2` 只审计每局首步，且合理落子、提示等部分判定与被测策略同源，不能继续作为发布证据；现已由 `m9.3-reasonable-v3-independent` 取代，runner 对完整 12 手轨迹逐手采集审计数据，placement 独立枚举可行动作、hint 将“错过有用提示”计为失败、belief 只用离线真值验证实际隐藏值是否仍在物理可能域，真值不进入策略。正式 180 个配对 seed 的结果为：合理落子 **2160/2160**、提示合理性 **2160/2160**、信念物理一致性 **13108/13108**、协调遵守 **180/180**，发布闸门通过；报告为 [`evals/2026-07-23-m9-3-reasonable-v3-independent-report.json`](evals/2026-07-23-m9-3-reasonable-v3-independent-report.json)。旧胜率候选质量与隐藏采样增益仍未达到原诊断门槛，但已明确只作诊断参考，不属于现行“合理队友”发布闸门。

**2026-07-23 M9.3 四项审查问题修复**：

1. `hint_policy` 只有经真人确认升级为 `hard_commitment` 的规则可以决定提示；`strong_preference` / `suggestion` 不再硬覆盖提示决策。
2. Provider 非法输出、超时、预算、熔断等 fallback 路径固定保持 `revealIntent=no`，不再被策略或 belief 二次改写。
3. 可能世界采样升级为 `possible-worlds-v2-deterministic`：固定 seed 下使用由预算换算的确定性节点上限，墙钟时间仅作 telemetry，不再决定搜索截断和候选排序。
4. 候选主路径默认值恢复为关闭；在本轮独立报告完成复核并重新签署前，`AGENT_CANDIDATE_ENGINE_V1=false`，隐藏采样继续默认关闭，模型选择器不脱离候选主路径单独启用。

本批新增/更新策略解释器、TurnCoordinator、value belief、求解器、采样器、Agent Lab runner/benchmark、独立 reasonableness audit 及对应单测。最终验证为全仓 typecheck 通过、服务端 **57 文件 / 410 项测试全绿**。M9.3 工程与现行发布闸门至此完成；M9 整体仍未完成，下一阻塞项为 M9.4 完整 Socket 并发矩阵和定向测试 20 次重复验收。

## 后端里程碑

| 里程碑 | 要做什么 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| M0 脚手架 | npm workspaces 三包、shared 类型、Express + Socket.IO、`/healthz`、Railway 配置、构建/启动脚本。 | 已完成 | 单服务部署基础已就位。 |
| M1 条件引擎 + 关卡数据 | `conditionEngine.ts`、关卡 loader、区段 1-6 到 0-5 归一化、条件单测。 | 已完成 | 已支持当前 1-13 关条件；`min-color-cards`、`has-duplicate-value`、`forbidden-values` 已接入关卡数据、loader 测试和前端文案。 |
| M2 入座 / 准备 / 房主 + payload 校验 | `player:join`、同昵称重连、准备、房主产生、zod 入站校验、`room:state` / `room:error`。 | 已完成 | 重复昵称、补位、进行中离开等边界已按 follow-ups 收口。2026-07-13：同昵称+正确密码不再被拒（`该昵称已在房间中`），改为切断旧（可能半死）连接、由重连路径接管席位，避免旧 socket ping 超时前一直锁号；`room:reset` 同时切断其它遗留连接。 |
| M3 选关 / 讨论 / 持久化读 | 房主开始、选关、进入讨论、讨论计时、聊天、启动加载进度。 | 已完成 | 进度与设置持久化路径已落地；本地/非生产允许全关卡测试，production 仍按通关进度顺序解锁。 |
| M4 出牌核心 | 发牌规则、可见性、动作层 `applyPlacement`、抢先手、交替回合、回合计时、超时判负、私有手牌遮蔽。 | 已完成 | 固定 24 张牌库、随机抽 12 张、可解性校验已接入。 |
| M5 提示系统 | `pendingHint` 窗口、`hint:decide`、提示标记额度、提示翻开牌公共可见、提示期间暂停。 | 已完成 | 提示窗口超时按 No，不判负。2026-07-14：窗口时长从固定 5 秒改为与 `thinkSeconds` 等长，`HINT_WINDOW_MS` 降级为仅测试覆盖。 |
| M6 揭示 / 结算 / 写盘 | 放满 12 张自动揭示、统计 6 段、条件校验、成功写通关进度、下一关 / 重试 / 返回选关。 | 已完成 | 失败原因、通关推进和写盘失败反馈已收口。 |
| M7 打磨 + Railway 验收 | 非生产禁用 `room:reset`、断线保留、host 转移、计时器幂等、可见性防泄漏、payload 测试、Railway 端到端验收。 | 基本完成 | 代码侧 follow-ups、typecheck、79 个服务端测试与 31 个 Playwright 场景通过；Railway 构建配置已改为单次 `npm run build` 并修复 shared/client/server 构建产物路径问题。仍需在真实 Railway 验证 Volume 进度保留、WebSocket 与 `SIGTERM` flush。 |
| M8 3/4 人 | 固定 4 座并支持 2–4 人弹性开局；补齐 3/4 人发牌、可见性、回合、结算、socket 流程和测试。 | 基本完成 | 后端弹性扩容、前端多人 UI、3/4 人完整成功 Socket 对局、完整 Playwright 对局和 4 真人手机视口测试均已通过；剩余多人真机与 Railway 人工验收。 |
| M9 协作 Agent | attempt memory、感知/实体提取、每座位策略、实时出牌、候选评估、双 Provider、deadline、telemetry、贯穿式离线 eval harness。 | 进行中 | **M9.0–M9.2 已完成代码框架与本地验收**：作用域/安全视图、AttemptMemory、每座位 `SeatStrategy`、讨论与实体管线、RetryBrief、OpenAI/DeepSeek adapter、预算/deadline/Abort/stale 防护、placement+hint 单次决策和 Provider contract 均已落地。**M9.3 已完成工程与独立合理队友闸门**（2026-07-23）：候选/top-K、公开 Contract/完整 DSL、策略摘要门禁、派生态 memory、review v2、`value-belief-v2` 与 2/3/4 人评测完成；独立完整轨迹评测为合理落子 2160/2160、提示 2160/2160、belief 13108/13108、协调 180/180，候选与隐藏采样在重新签署前仍默认关闭。**未完成**：M9.4 完整 Socket 并发与 20 次重复验收；M9.5 repository contract、复现 telemetry、幂等 finalizer；M9.6 通用离线 eval；R7 产品与发布总验收。 |
| M10 PostgreSQL + 可观测性 | 迁移 progress/settings，保存 attempt、每座位策略、`LevelRunMemory` / `RetryBrief`、Agent 决策与模型指标。 | 未开始 | 实时 GameRoom 与本局 memory 继续留在内存，不承诺中途对局重启恢复；只恢复已结束 attempt 的同关公开经验。 |
| M11 复盘与可视化 | 基于 PostgreSQL 数据的决策轨迹、成本/延迟趋势页面与人工标注展示。 | 未开始 | 批量模拟、模型对照与 eval 指标由 M9 的贯穿式 eval runner（M9.0 建立、M9.6 完善）负责；M11 不从零建 eval，只做可视化与复盘。 |

### 后端当前重点

- **收口 M7/M8 人工验收**：本地自动化已全绿；后续验证多人真机、Railway Volume/WebSocket/重启与 `SIGTERM` flush。
- ~~**M9.0 领域架构**~~：已完成（2026-07-14）——作用域 ID、`DiscussionView`/`TurnView`、Observation/Entity/SeatStrategy、共享/私人 memory、`ModelClient` 与 mock、最小 eval runner（`server/src/agentlab/`）。
- ~~**M9.1 讨论与每座位策略**~~：已完成（2026-07-14）——`DiscussionCoordinator`、实体验证管线、`AgentStrategyPlanner`、`AgentRuntime` Socket 接线、失败结果 `RetryBrief`、游戏事件 observation 写入与实体/RetryBrief 注入模型上下文。
- **M9.2 真实 Provider 发布验收**：历史 30 次 turn top-K 为 30/30 合法、p95 2.748s、零超时/零 fallback；发布前仍需确认 TLS 校验开启，并在模型 alias、参数或 Provider 行为变化后重跑冻结批次。
- ~~**M9.3 候选与合理队友闸门**~~：Slice 1–5、目标 B 和独立完整轨迹复核均已完成；现行 `m9.3-reasonable-v3-independent` 发布闸门通过。候选主路径在本轮报告重新签署前保持默认关闭，隐藏采样默认关闭。
- **M9.4 并发安全正式收口（下一项）**：房间级单飞、Agent race 与取消/stale 主体代码已落地；补完整多 Agent/Socket 并发矩阵，验证 2–3 Agent 抢先手、真人赢 race、慢模型期间 hint/retry/phase 切换，定向测试重复 20 次无随机失败。
- **M9.5–M9.6**：随后实现 repository contract + 内存实现、复现 telemetry 和幂等 finalizer；再完善脚本/启发式/模型/回放通用离线 eval，一条命令生成至少 200 局版本化 JSON/Markdown 报告。PostgreSQL 实现仍属于 M10。
- **玩家账号体系**：ADR-0006 决策一（隐式注册、密码接管座位、fail-closed 账户库）已于 2026-07-18 落地；2026-07-20 按 [ADR-0007](docs/adr/0007-account-password-lifecycle-and-admin-management.md)（已接受）切换为第一阶段邮箱身份方案——邮箱 + 密码显式注册 / 登录、schema v2 账户库、玩家自助改昵称 / 改密 / 改邮、`credentialVersion` 会话失效、管理员账号维护后端均已落地。生产 `/`、`/account/register`、`/account/security` 与 `/admin/*` 已接真实 Socket 并有本地自动化回归。第一阶段明确不做邮箱验证、密码找回、恢复密钥与邮件 Provider，域名就绪后另行立项。Agent 长期关系记忆按 ADR-0006 决策二推迟至 M9.5 之后，前置条件为稳定 `agentProfileId` 与 persona roster 决策。
- 当前 `npm.cmd run typecheck`、`npm.cmd run build`、服务端测试与完整 E2E 已通过；后续每批 M8/M9 改动后继续重跑，防止破坏 M0-M7。
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
| M6 打磨 | 动效、`reduced-motion`、响应式、移动端 placing、连接 / 重连 / 离线三态、空 / 错 / 超长态、Playwright E2E。 | 基本完成 | review fixes 已大体落地，新增重连禁操作、主动 room sync、移动端布局、focus trap、skip link、Pill 键盘、隐藏牌防泄漏等 E2E；2026-07-13 完成移动端视口修复并治理 context 串行污染，最新全量 31/31。真机横竖屏与安全区仍待人工验收。 |
| M7 上线验收与回归硬化 | 前端 build/typecheck/e2e 全绿；本地双开完整流程验收；Railway 页面和 Socket 行为验收；文档口径回写。 | 进行中 | 根目录 typecheck、build、服务端测试与标准 Playwright 全量命令均通过；本地 3/4 真人及脚本 Agent 混合完整流程已自动化，仍缺 Railway 和真机手动验收。 |
| M8 3/4 人前端支持 | UI 固定展示 4 座并按实际就位人数派生座位、TopBar、回合、手牌数量和可见性；补多人 E2E。 | 基本完成 | 多人 selector、队友栏、固定 4 座和 AI 加/撤 UI 已实装；3/4 真人、1 真人 + 1/3 Agent、2 真人 + 1 Agent 完整 E2E 与 4 真人手机视口场景均已通过。 |
| M9 Agent 前端支持 | Agent 座位、消息、加/撤入口、思考/降级状态、公开策略摘要。 | 进行中 | 基础座位、消息和入口已完成；待增加各 Agent 的公开 `SeatStrategy` 摘要、Agent 不可用/fallback 状态与复盘入口。 |

### 前端当前重点

- 真机验收移动端视口修复：iOS Safari / Android Chrome 上横竖屏切换、地址栏伸缩、安全区、软键盘不遮挡输入（对照 `plans/2026-07-10-mobile-gameplay-viewport-fixes.md` §10 矩阵）。
- 对 review fixes 做人工 UI/a11y 验收：窄屏 placing、Reveal/Result、HintPrompt 焦点循环、断线只读态、时钟提示不重叠。
- 在 Railway 上完成页面加载、多人 Socket 同步、Volume 持久化、重启语义和 `SIGTERM` flush 验收。

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

1. **M9.4 并发安全收口**：补完整多 Agent/Socket race、取消/stale、hint/retry/phase 切换矩阵，并定向重复 20 次。
2. **M9.5 Telemetry / Repository / Finalizer**：冻结可复现记录字段，完成 repository contract、内存实现和幂等结算边界；暂不接 PostgreSQL。
3. **M9.6 离线 Eval**：补齐脚本/启发式/模型/回放策略和 ≥200 局版本化 JSON/Markdown 报告。
4. **R7 / M9 总验收**：Agent 公开状态与最小复盘、真实 Provider 配置冻结、全阵容 E2E、Railway 与移动端真机。
5. **M7/M8 人工收口**：与 R7 合并完成 Railway Volume/WebSocket/重启语义、`SIGTERM` flush 和真机验收。
6. **M10–M11**：M9 完成后另立 PostgreSQL 实施计划，再做持久化复盘与可视化；长期关系记忆须等待 M9.5 与独立 ADR。
7. **持续补关卡**：第 14 关起每批加入后跑求解器与核心流程回归。

