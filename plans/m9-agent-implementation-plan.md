# M9：有记忆的协作 Agent 实施计划

> 状态：**superseded for remaining work / 已完成里程碑与历史实施基线**
> 2026-07-18 起，尚未完成的 M9.2 发布验收、M9.3–M9.6 与产品侧收口统一由 [Agent 剩余开发执行计划](2026-07-18-agent-remaining-development-plan.md)承接；本文继续保留 M9.0–M9.2 的验收记录与原始里程碑定义。
> 日期：2026-07-14
> 上游架构：[docs/architecture.md](../docs/architecture.md)
> 记忆设计：[docs/agent-memory-system-design.md](../docs/agent-memory-system-design.md)
> ADR：[运行时与持久化](../docs/adr/0001-runtime-state-and-persistence.md) · [Agent 编排](../docs/adr/0002-agent-orchestration-and-model-routing.md) · [隐藏信息候选](../docs/adr/0003-hidden-information-candidate-evaluation.md) · [分层记忆与每座位策略](../docs/adr/0004-agent-memory-scopes-and-seat-strategy.md)

## 目标

把现有脚本 Agent 升级为一个逻辑连续、遵守隐藏信息、能参与讨论并执行自身 `SeatStrategy` 的 AI 队友。M9 实现 attempt 短期记忆、同进程同关 `RetryBrief` 和当前 PlaySession 的软性协作经验；失败退出后的跨重启恢复由 M10 PostgreSQL 落地。M9/M10 不做跨会话用户画像或关卡答案长期记忆。

## 已有基础

- 2–4 人弹性开局与固定 4 座位。
- 房主加/撤 Agent 事件和前端入口。
- `InMemoryAgentRegistry`、脚本 Agent、`handoff.ts` 出牌/hint 循环。
- 真人与 Agent 共用 `applyPlacement` / `applyHintDecision`。
- `publicRoomState` / `privateHandForSeat` 可见性遮蔽。

## M9.0：领域模型和 attempt memory

> 状态：**已完成（2026-07-14）**。验收全部通过：`server/tests/attemptIdentity.test.ts`、`chatAttemptScope.test.ts`、`agentViews.test.ts`、`attemptMemoryStore.test.ts`、`agentOrchestrator.test.ts`、`agentLabRunner.test.ts`。

1. 增加 `campaignId`、`playSessionId`、`levelRunId`、`attemptId`；每次进入新 discussion 时生成新 `attemptId`，仅同关 retry 沿用 `levelRunId`。
2. 聊天消息增加 `attemptId`，构造 Agent context 时只读取当前 attempt。
3. 拆分 `DiscussionView` 与 `TurnView`；讨论视图类型上不含 `hand`。
4. 新增 `AgentObservation`、`MemoryFact`、`SeatStrategy`、`StrategyRule`、`AgentBelief`、`AttemptMemory`、`RetryBrief` 类型与 schema。
5. 实现 `AttemptMemoryStore`：公开 observation/实体共享，每座位的私有 observation、实体信念、策略、行动、信念与承诺隔离。
6. memory 存在服务端内存，不写 Volume；结果阶段生成同进程可用的 `RetryBrief`，持久化 repository 在 M9.5 定义、M10 落地。
7. 新增 `ModelClient`、`AgentOrchestrator` 与可注入 mock，不接真实 API 即可跑通测试。
8. 建立最小 eval runner 骨架（贯穿式，后续里程碑只扩展不重建）：fixture schema、固定发牌/采样种子、mock 座位策略，不经 Socket 直接驱动动作层跑单步与整局。

### M9.0 验收

- retry 后旧 chat、手牌、私人信念和私人策略不会进入新 attempt；同关仅允许受控 `RetryBrief` 进入讨论。
- 所有 Agent 共享公开 observation/实体，但使用各自锁定的 `SeatStrategy`，私人 memory 彼此隔离。
- discussion view 的序列化结果不可能包含手牌。
- 没有来源 observation 的实体事实不能提升为公开承诺或硬策略。
- 最小 runner 能用 mock 策略以固定种子重放同一局并得到确定性结果。

## M9.1：讨论协调、实体提取与每座位策略

> 状态：**已完成（2026-07-14）**，见 `observationsAndEntities.test.ts`、`strategyPlanner.test.ts`、`discussionCoordinator.test.ts`、`agentRuntimeFlow.test.ts`、`gameEventObservations.test.ts`、`agentViews.test.ts`。游戏事件（placement/hint/phase/result）observation 写入、讨论发言顺带实体候选（消息 id → observation id 映射后经 `entities.ts` 校验入库）、实体与 `RetryBrief` 经 `buildDiscussionView(room, seatId, memory)` 注入模型上下文、conflicted 实体事实引用降级 `unresolved` 均已落地。

1. 实现 `DiscussionCoordinator`：Agent 顺序发言、冷却、最大次数、阶段结束取消。
2. 把公开聊天和游戏事件写为带 `attemptId + phaseVersion + turnVersion + visibility` 的 observation；旧版本响应不得写入。
3. 实现实体验证管线：从 observation 提取座位、区段、承诺和策略候选；保留来源 ID、显式/推断/冲突状态，私有推断不得回写共享事实。实体管线已接入 `AgentStrategyPlanner`：指向 `certainty === "conflicted"` 实体事实来源消息的策略规则一律降级为 `unresolved`（ACR-02 收口）。
4. Agent 输入包含关卡、当前 attempt 公开聊天/实体、其他 Agent 的公开发言，以及仅在同关 retry 时提供的 `RetryBrief`；不含任何手牌。
5. 实现按座位工作的 `AgentStrategyPlanner.compileForSeat(seatId, discussionView)`，每个 Agent 独立生成自己的 `SeatStrategy`。
6. 策略区分 `hard_commitment`、`strong_preference`、`suggestion`、`unresolved`，并保留 `sourceMessageIds`；优先级固定为服务端规则 > 人类明确公开约定 > Agent 推断 > 启发式。
7. 讨论结束时每个 Agent 自动锁定自己的策略，不增加房主审批/编辑步骤；无法确认的内容进入 `unresolved`。
8. 房主提前结束讨论时取消未完成发言，每个 Agent 基于当时已有的公开内容独立收口；信息不足时锁定空策略并退回启发式。
9. 结果阶段生成 `RetryBrief`：公开策略/承诺、通过/失败区段、公开复盘、用户纠正和未解决问题；不包含旧手牌、私人信念、私人计划或思维链。

### M9.1 验收

- 2 真人 + 1 Agent 能看到 Agent 发言；该 Agent 能形成并锁定自己的策略。
- 多 Agent 基于相同公开讨论可生成不同但不违反公开承诺的 `SeatStrategy`，且互相不能读取私人计划。
- 多 Agent 发言不会并发重复或在 placing 后迟到写入 chat。
- 暗号冲突进入 `unresolved`，不会被误当成正式规则。
- 同关 retry 能读取 `RetryBrief`，下一关与重新选关不能读取上一关摘要。

## M9.2：模型接入与实时决策

> 状态：**代码实现与本地验收已完成（2026-07-15）**，见 `providerConfig.test.ts`、`modelProviders.test.ts`、`modelBudget.test.ts`、`turnCoordinator.test.ts`、`modelAgentHandoff.test.ts`、`providerContract.test.ts`。落点：`server/src/agent/providers.ts`（OpenAI 兼容 adapter，DeepSeek 同接口只差 baseURL）、`providerConfig.ts`（env 按任务路由与生成参数）、`budget.ts`（按 attempt 原子预留的调用/token 预算）、`turnCoordinator.ts`（单次 `TurnDecision` + `revealIntent` 缓存 + deadline/Abort/stale 防护）、`modelAgent.ts` + `runtime.createSeatAgent`（HostAddAgent 接线）、`telemetry.ts`（六项指标及人数/关卡分组）、`agentlab/providerContract.ts` 与 `createOrchestratorSeatPolicy`（契约/单步评测）。本地服务端 203/203、typecheck、build、Provider contract mock 3/3 和目标 E2E 7/7 已通过。**剩余发布门槛**：`.env` 填入真实 key 后联调真实模型并验证第 3 条初始候选的 p95/deadline/fallback 指标；该外部验收不阻塞 M9.3 开发。

> **真实 Provider 首轮验收（2026-07-15）：未通过发布门槛。** 三条任务路由与 API key 均已成功解析，真实请求无 Provider 网络错误；3 个契约 case 中 2 个通过、1 个 discussion 非法输出，`illegalOutputRate = 33.3%`，延迟为 turn 5223ms、discussion 7509ms、retry brief 3182ms，综合 p95 7509ms。discussion 单独复测可返回合法结构，但耗时 18573ms，存在明显波动。默认 `thinkSeconds = 5` 时 turn 模型预算约 4000ms，本次 5223ms 已超过生产 deadline，因此当前模型/参数不能作为 5 秒设置下的稳定默认。另发现真实契约脚本未主动加载根目录 `.env`、契约统一使用 10 秒 deadline 且混合不同任务统计 p95、样本量仅 3 条，以及验收环境设置了 `NODE_TLS_REJECT_UNAUTHORIZED=0`。详细问题与关闭标准见 [M9 Agent 计划问题清单](m9-agent-plan-review-issues.md#m92-真实-provider-首轮验收2026-07-15)。这些问题不阻塞 M9.3 开发，但关闭前 M9.2 不得标记为真实模型发布验收完成。

> **真实 Provider 第二轮验收（2026-07-17）：讨论静默根因修复，路由重新定档。** 首轮 discussion 非法输出的根因是 `deepseek-v4-pro` 为推理模型、思维链与正文共用 `max_tokens`（1200 上限被推理烧满后正文截断）。本轮实测对比后重定初始候选（取代第 3 条）：讨论/策略 `gpt-5.4 + reasoning_effort=low`（4000 token，实测 5-14s、质量与 pro 相当）；出牌维持 `gpt-5.4-mini + low`（上限 500→2000）；RetryBrief 改 `deepseek-v4-flash`（2000 token，避开 pro 的推理波动）。配套修复：token 上限收敛到 `providerConfig.maxOutputTokensFor` 单一来源（`AGENT_*_MAX_OUTPUT_TOKENS` 环境变量此前是死代码）、DeepSeek 分支补发 `reasoning_effort`、策略收口并行化 + 请求级 low 档 + deadline 8s→20s、讨论调度器加连续失败上限（3 次）、契约用例升级为真实规模视图且 deadline 对齐生产（讨论/RetryBrief 30s）。真实契约 repeat=3：discussion 3/3（p95 9345ms）、retry_brief 3/3（p95 7200ms）、turn 2/3（p95 9012ms，一次超出 thinkSeconds=10 对应的 9s 模型预算）。**剩余门槛**：turn 在真实规模视图下 p95 贴着 9s deadline，`thinkSeconds=10` 设置下 `deadlineMissRate` 可能超过 10% 阈值——带 Agent 对局建议 `thinkSeconds ≥ 15`（第 9 条已有此预留），或后续在 M9.3 评测中对 turn 试 `reasoning_effort=none` / `gpt-5.4-nano`。服务端 248/248、mock 契约 3/3 全绿。

> **出牌延迟策略更新（2026-07-21）**：针对玩家可见等待偏长，turn 默认改为 `gpt-5.4-mini + reasoning_effort=none`；可见思考封顶 10 秒，10 秒房间目标 5–8 秒。模型预算改为 `min(thinkSeconds - 2.5s, 10s)`，并在 `AbortController` 之外增加本地硬截止，即使 Provider 忽略取消也会立即采用规则安全策略。该配置仍需用真实 Provider 样本重新签署质量、fallback 与 deadline 指标。

1. 安装 `openai` TypeScript SDK；分别实现 OpenAI 与 DeepSeek adapter。
2. env 按任务配置 provider/baseURL/key/model；不引入 Anthropic 依赖或 `ANTHROPIC_API_KEY`。
3. 初始候选：讨论/策略使用 `deepseek-v4-pro`；出牌使用 `gpt-5.4-mini`。
4. 把 placement 与 hint 合并为 `TurnDecision { cardId, segment, revealIntent, appliedStrategyRuleIds, relaxedStrategyRuleIds }`。
5. `TurnCoordinator` 先落子，进入 hint window 后消费缓存的 `revealIntent`。
6. 双人局盲牌：prompt 与候选需显式标记自己不可见数值的盲牌。规则已定：剩余盲牌在压线那一手的 hint 窗口结算之后才翻开（rules.md），因此缓存的 `revealIntent` 在 hint 决策时不会过期，无需重评机制；Agent 在下一次出牌决策的全新调用中自然读到翻开后的手牌。
7. 使用 Zod/JSON Schema 校验模型输出；非法输出进入 fallback。
8. 使用 `AbortController`，模型 deadline 比游戏 deadline 至少提前 1 秒（默认 10 秒回合中模型预算为 9 秒，与 architecture §6.2 一致）；模型完成时间与玩家可见落子节奏分离，通常在窗口 50%–65% 时落子，最少等待 5 秒，模型耗时超过目标节奏时不追加等待。
9. 他人回合仅允许预热 HTTP 连接/SDK client，以及预计算不依赖下一步桌面状态的候选骨架；正式 LLM 请求必须在当前 `attemptId + phaseVersion + turnVersion` 确定后才发出，所有缓存以这些版本为 key；被取消的预热/竞速请求计入成本但不计入决策失败。带 Agent 的对局可建议放宽 `thinkSeconds`（已是 `RoomSettings` 可配项）。
10. attempt/phase/turn 改变时取消旧请求；旧响应不得更新 observation、实体、策略、私人 memory 或落子。
11. 成本控制：每 attempt 与每日的模型调用次数 / token 预算上限，覆盖全部模型调用（决策、讨论发言含顺带实体提取、结果阶段 `RetryBrief` 生成）；超限进入与超时/Provider 错误/非法输出相同的统一降级状态机（候选第一名 → 脚本 bot），仅在 fallback reason 中区分 `budget_exceeded`，并记录结构化错误。
12. 在 M9.0 的 runner 上增加 Provider 契约与单步决策评测：延迟、输出格式、非法输出率，可用 mock 与真实模型分别运行。

### M9.2 验收

- 定义并记录六项指标，按人数与关卡分组统计 p50/p95/p99 并标注样本量：`providerLatencyMs`（单次模型网络调用）、`decisionEndToEndLatencyMs`（轮到 Agent 至合法落子完成）、`deadlineMissRate`、`fallbackRate`、`cancelRate`（因 phase/turn/race 变化被取消，不计失败）、`illegalOutputRate`。
- 阈值（正常网络下）：p95(`providerLatencyMs`) ≤ 模型 deadline，`deadlineMissRate` 与 `fallbackRate` ≤ 10%；不达标的模型/配置不得成为稳定默认或进入发布，但不阻塞 M9.3 候选算法的开发。
- 空响应、非法 JSON、错误 cardId、错误区段、429、5xx、断网均不卡房。
- 一次模型调用同时决定 placement 与 hint。
- 双人局中 Agent 能正常打出盲牌；压线一手的 hint 决策先于盲牌翻开结算，翻开后的手牌出现在 Agent 下一次决策视图中。

## M9.3：候选生成和兜底

1. 从 `TurnView` 枚举全部 cardId × segment 动作合法候选。
2. 只剪掉从可见信息可严格证明必输的动作。
3. 使用当前座位 `SeatStrategy`：`hard_commitment` 在存在可执行候选时过滤；`strong_preference` / `suggestion` 参与评分；`unresolved` 不参与硬过滤。
4. 策略与全部合法动作冲突时，服务端游戏规则优先，放宽策略并记录 `strategy_conflict`、规则 ID 和原因，不得卡住回合。
5. 用区段负载、公开牌信息和本座位私人信念完成第一版启发式评分；自己不可见数值的盲牌按未知牌信念处理，与未知牌采样共用机制。
6. LLM 只允许从 top-N 候选中选择。
7. fallback：候选第一名 → 脚本 bot；不得直接随机落子。
8. 后续加入未知牌采样，并在采样世界中调用完全信息求解器估算成功率。
9. 采样求解超过事件循环预算时迁移到 Worker Thread。

### M9.3 验收

- 候选模块公开入口不能接收 `GameRoom`。
- 测试证明候选分数不随服务器真实隐藏牌变化，只随 Agent 可见信息和采样种子变化。
- 决策可追溯到应用或放宽的 `StrategyRule`；冲突规则不会造成无动作或超时。
- fallback 优于当前“第一张牌放到最少牌区段”的脚本策略，以 M9.0 起持续扩展的 eval runner 批量模拟量化（不依赖尚未开始的后续里程碑）：≥ 200 局配对种子对比，通关率高出 ≥ 10 个百分点（口径可调，但必须落成数字；批量报告与置信区间等完善项见 M9.6）。

## M9.4：抢先手与并发

1. 先改造 `handoff.ts` 的错误处理：现有实现在 `applyPlacement` 抛错时无条件用 `fallbackPlacement` 再放一张牌，race 中输掉竞态的 Agent 会因“还没轮到你”类错误触发 fallback 造成重复落子；必须按 `RaceLost`/`StaleTurn`（静默放弃）、`InvalidModelDecision`（走 fallback）、`InternalInvariantError`（记录并终止本次 handoff）分类。
2. 为 `continueTurnOrHandoff` 增加房间级单飞/串行化：每房间一个 Agent 调度队列或 in-flight 标记；`await` 挂起期间新事件触发时，仅做续跑标记由现有循环消化，不启动第二个循环实例（现有 `phaseVersion`/`turnVersion` 校验保留为第二道防线）。
3. Agent 允许参加 `turn === "race"` 的第一手。
4. Agent 使用短随机思考延迟；真人或其他 Agent 先出后取消未完成请求。
5. 多 Agent 不能因并发结果产生重复落子；最终仍由动作层仲裁。
6. 记录被取消的 race 请求，但不计为决策失败。

### M9.4 验收

- 2 个 Agent 同时参与 race 时，桌面只出现一张第一手牌，输掉竞态的一方不产生任何落子或 fallback。
- 真人在 race 中先出后，Agent 的未完成请求被取消，且旧响应不落子、不更新 memory。
- 被取消的 race 请求出现在 telemetry 中且不计入决策失败率。
- 用人为延迟的 mock 模拟慢速模型响应，挂起期间并发注入 Socket 事件（真人落子、hint 决策、重试推进）：任意时刻至多存在一个活动 handoff 循环，桌面不出现重复落子，telemetry 中无重入导致的 `InvalidModelDecision`。

## M9.5：Telemetry 与 PostgreSQL 准备

1. 每次请求记录 `attemptId`、seat、phase/turn version、provider、model、latency、tokens、decisionId 和 fallback reason。
2. 不记录模型完整思维链；输入视图需要脱敏或只保存 hash/受控快照。
3. 定义 `game_attempts`、`seat_strategies`、`level_runs`、`retry_briefs`、`agent_decisions` schema 和 repository 接口；M9 只定义接口和内存实现，PostgreSQL 实现在 M10。
4. 决策记录补充 `appliedStrategyRuleIds`、`relaxedStrategyRuleIds`、`strategyConflictReason` 与 memory/context 版本。
5. telemetry 增加复现字段：`promptVersion`、`viewSchemaVersion`、`agentStrategyVersion`、`candidateEvaluatorVersion`、`modelSnapshot` 与 `reasoningEffort`/采样参数、`dealSeed`/`samplingSeed`、`evalSuiteVersion`、候选列表 hash、最终选择及其来源（模型 / 候选第一名 / 脚本 bot）、最终 attempt 结果；prompt 输入只存受控快照或 hash，聊天与昵称字段限定采集范围。
6. PostgreSQL 不可用时不得阻塞实时出牌；记录错误并按降级策略继续，UI 可提示退出后无法恢复本次失败经验。

### M9.5 验收

- 每条 Agent 决策日志都能通过 `attemptId` + `decisionId` 关联到 provider、model、latency、tokens 与 fallback reason。
- 策略、实体和决策能通过来源 ID 关联；能够计算行动与自身 `SeatStrategy` 的一致率。
- 落库内容不含模型完整思维链，输入视图只有 hash/受控快照。
- M9 阶段 repository contract 与内存实现通过测试；M10 的 PostgreSQL 不可用时实时对局仍继续并出现结构化降级日志。

## M9.6：离线 eval harness 完善

> architecture §6 要求“模型选择必须通过项目 eval 后才能成为稳定默认”，本阶段落实该要求。runner 骨架自 M9.0 建立、M9.2/M9.3 持续扩展，本阶段完善批量对照、报告与质量维度，不从零重建。

1. 完善离线模拟对局 harness（`agent-lab` 雏形）：不经 Socket，直接驱动动作层跑完整 attempt。
2. 定义 eval 专用 `SeatPolicy` 接口（`decideDiscussion` / `decideTurn` / `decideHint`）驱动全部座位（含代真人座位），实现 `ScriptedSeatPolicy`、`ReplaySeatPolicy`（回放真实玩家历史）、`HeuristicSeatPolicy`、`ModelSeatPolicy`；仅用于离线 agent-lab，不开放为生产入口。
3. benchmark 版本化：每个 case 落成 manifest（`suiteVersion`、`levelId`、`playerCount`、各座位 policy、`dealSeed`、`samplingSeed`、`promptVersion`、`modelSnapshot`）；脚本/启发式/LLM 使用相同关卡与配对种子；阈值在运行正式 eval 前冻结；模型存在随机性时同一 case 重复运行并记录分布。
4. 统计通关率、非法输出率、fallback 率、延迟分位数，按关卡、人数、Agent 数分组报告并附样本量与置信区间，输出结构化报告。
5. 增加策略来源可追溯率、行动与自身策略一致率、策略冲突/放宽率、人类明确约定提取准确率、多 Agent 公开承诺冲突率，以及 retry memory 开/关的重复错误率对比。
6. 发布前进行小规模人肉盲评：Agent 发言与决策的有用性、清晰度、自然度、信任感与游戏趣味。
7. 模型、memory/context 或候选评分逻辑变更时必须重跑 eval；alias 升级重跑后才能改默认（对应 architecture §10 可复现要求）。

### M9.6 验收

- 一条命令可按 manifest 跑 ≥ 200 局并输出分组通关率对比报告（脚本 bot vs 启发式候选 vs LLM），报告含样本量与置信区间。
- M9.2 的模型初始候选与 M9.3 的“fallback 优于脚本策略”均以该贯穿式 runner 的数字为准。
- harness 只使用 Agent 可见视图驱动决策，不泄漏真实隐藏牌。

## 测试矩阵

- memory：新 attempt 隔离、同关 RetryBrief 白名单、跨关清理、公开 observation/实体共享、私人 memory 隔离。
- 策略：每座位独立 `SeatStrategy`、来源可追溯、冲突进入 unresolved、硬约束过滤与结构化放宽。
- 可见性：讨论无 hand，出牌无队友牌值/桌面暗牌值/未翻己方盲牌值。
- 调度：发言顺序、提前结束、迟到响应、多个 Agent。
- 实时：Abort、stale response、非法输出、Provider 错误、fallback。
- 决策：placement+hint 原子计划、候选限制、隐藏信息不穿透。
- 盲牌：双人局 Agent 持盲牌时的候选生成、prompt 表达，以及“hint 结算后才翻开盲牌”的顺序保持。
- race：竞态失败静默放弃，不触发 fallback 重复落子。
- 并发：慢速模型响应期间并发注入事件，任意时刻至多一个活动 handoff 循环，无重复落子。
- 预热：正式请求只在版本确定后发出，缓存按 `attemptId + phaseVersion + turnVersion` 命中。
- 成本：调用/token 超预算时走统一降级状态机（候选第一名 → 脚本 bot）。
- 流程：1 真人+Agent、2真人+1Agent、2真人+2Agent、3真人+1Agent。
- 回归：纯真人 2/3/4 人流程不依赖任何 API key。

## 不在 M9 范围

- 跨会话长期记忆、用户画像或关卡答案库（同关 `RetryBrief` 不属于此项）。
- 中途真人/Agent 控制权交接。
- 全 Agent 生产入口。
- 多房间、多实例和 Redis。
- AgentScope/AutoGen 生产运行时。
