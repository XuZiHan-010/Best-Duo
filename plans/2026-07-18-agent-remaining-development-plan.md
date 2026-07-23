# Agent 剩余开发执行计划（2026-07-18）

> 状态：**active / 当前 Agent 剩余工作唯一执行计划**
> 承接：[M9：有记忆的协作 Agent 实施计划](m9-agent-implementation-plan.md)中尚未完成的 M9.2 发布验收、M9.3–M9.6 与产品侧收口工作
> 上游架构：[当前架构](../docs/architecture.md) · [Agent 记忆系统设计](../docs/agent-memory-system-design.md)
> 关键 ADR：[Agent 编排](../docs/adr/0002-agent-orchestration-and-model-routing.md) · [隐藏信息候选评估](../docs/adr/0003-hidden-information-candidate-evaluation.md) · [分层记忆与每座位策略](../docs/adr/0004-agent-memory-scopes-and-seat-strategy.md) · [玩家账号与长期记忆推迟](../docs/adr/0006-player-accounts-and-deferred-agent-memory.md)

## 1. 目标

从当前已经贯通的“讨论 → 每座位策略 → 模型决策 → 出牌/hint → RetryBrief”工程链路出发，完成以下发布闭环：

1. 恢复全仓库绿色基线，清除账号前端半接入和并行测试抖动。
2. 收口 Agent 抢先手、handoff 单飞、取消与 stale response 的并发安全。
3. 实现只消费安全视图的候选生成、策略约束、隐藏信息评估和可量化优于脚本 bot 的 fallback。
4. 用生产口径批量验证真实 Provider，冻结可发布的模型、参数和 Agent 回合时长。
5. 补齐可复现 telemetry、M9 repository 边界与离线 eval harness。
6. 完成用户可见的 Agent 策略、降级状态和最小复盘展示，为 M10 PostgreSQL 持久化提供稳定接口。

本计划完成时，M9 才可标记完成。M10 PostgreSQL 与 Agent 长期关系记忆不在本计划内实现，只定义进入门槛。

## 2. 当前基线与事实口径

### 2.1 已完成

- M9.0：作用域 ID、安全 `DiscussionView` / `TurnView`、AttemptMemory、公开/私有隔离、最小 Agent Lab。
- M9.1：讨论调度、实体提取、每座位独立 `SeatStrategy`、游戏事件 observation、同进程 `RetryBrief`。
- M9.2 代码框架：OpenAI/DeepSeek adapter、按任务路由、单次 `TurnDecision` + hint 意图缓存、deadline/Abort/stale 防护、调用/token 预算、六项基础 telemetry、Provider 契约脚本。
- M9.4 主体代码已提前落地：`handoff.ts` 已有房间级单飞、Agent race、真人先出后旧响应丢弃；`TurnCoordinator` 已能区分取消并记录 cancel telemetry。2026-07-19 补上 race 延迟前后的 token/回合校验和可中止延迟，避免失败者在赢家落子后才启动 Provider 请求。
- 玩家账号后端 Task 1–3 基本落地：持久 `playerId`、账号密码校验/接管、fail-closed 账户库、账号限流。

### 2.2 尚未完成或未通过发布门槛

- 2026-07-19 根目录 `typecheck`、build、服务端 278/278（37 文件）与 Playwright 39/39 已完成一轮全绿；R0 要求连续两轮全绿，尚需再执行一轮后才能勾选。
- M9.2 第二轮真实 Provider：discussion 3/3、retry brief 3/3；turn 2/3，p95 约 9012ms，贴近 `thinkSeconds=10` 对应的 9s 模型预算，尚不能签署稳定默认。
- M9.3 Slice 1–5 的工程开发已完成：公开 Contract/可执行 DSL、讨论摘要门禁、隐藏信息采样、派生态 memory、review v2、候选 telemetry 与 2/3/4 人冻结批次评测均已落地。180 个配对局未通过候选质量发布门槛，因此相关 feature flag 保持默认关闭；这是已签署的负向发布结论，不把未达标实现冒充生产默认。
- M9.4 单元级 race/取消回归已补齐，仍缺完整多 Agent/Socket 并发场景与定向测试 20 次重复验收，因此 R1 不标完成。
- Provider contract harness 已补 fallback/token、冷启动/连续调用维度和策略收口 case，mock 15/15；真实模式默认每个 fixture 重复 30 次，但未执行会产生费用的真实批量验收，因此 R4 不标完成。
- M9.5 只有内存 telemetry 基础，repository contract 与复现字段未完成。
- M9.6 只有单局/单步 runner 骨架，尚无版本化批量报告、置信区间和质量指标。
- Agent 前端缺公开策略摘要、Provider/fallback 状态与最小复盘入口。

若后续代码或测试结果与本节不一致，以代码、测试和 `docs/architecture.md` 为准，并在同一批改动中更新本计划状态。

## 3. 不可破坏的架构约束

1. 服务端始终是权威状态源；真人和 Agent 共用动作层，不复制游戏规则。
2. 候选模块的公开入口不得接收 `GameRoom`，只接收 `TurnView`、本座位 memory 投影、版本化 evaluator 配置和显式 RNG/seed。
3. 候选评分、采样和 eval 不得读取其他座位隐藏手牌、桌面暗牌真实数值、双人局本人尚不可见的盲牌值或服务端真实解。
4. `hard_commitment` 仅在存在可执行候选时过滤；与游戏合法性冲突时必须结构化放宽，不能卡住回合。
5. 模型只能从服务端提供的 top-N 候选中选择；动作层在落子前再次校验。
6. 所有异步写入绑定 `attemptId + phaseVersion + turnVersion`；取消或过期响应不能写 memory、发消息或落子。
7. 当前 attempt memory 和实时房间继续留在内存；M9 只定义 repository 接口及内存实现，PostgreSQL 在 M10 落地。
8. 不保存模型完整思维链；prompt/视图只保存 hash 或受控快照。
9. 长期关系记忆不得提前实现；必须等待 M9.5 repository 边界和稳定 `agentProfileId` 设计。
10. 纯真人 2/3/4 人流程不依赖 API key、数据库或 Agent 服务可用性。

## 4. 总体顺序与依赖

```text
R0 绿色基线
  ↓
R1 M9.4 并发安全收口
  ↓
R2 M9.3 候选系统 v1
  ↓
R3 隐藏信息评估 + 200 局候选验收
  ↓
R5 M9.5 Telemetry / Repository
  ↓
R6 M9.6 Eval 完善
  ↓
R7 Agent 产品展示与 M9 总验收

R0 ──→ R4 M9.2 真实 Provider 发布验收 ──→ R7
```

- R4 可在 R2/R3 开发期间独立推进，但不得在 R0 绿色前签署结果。
- R3 必须交付 M9.3 所需的最小批量评测；R6 再完善通用 harness，不允许把首次量化拖到 R6。
- R5 的字段设计依赖 R2/R3 最终确定的候选、冲突和采样数据结构。

## 5. R0：恢复绿色基线

### R0.1 完成玩家账号前端与 E2E

**涉及文件**

- `client/src/views/Login.tsx`
- `client/src/socket/adapter.ts`、`client/src/socket/client.ts`
- `client/src/store/` 下错误码映射或连接状态文件
- `client/e2e/accounts.spec.ts`
- 现有 E2E 登录 helpers

**任务**

1. 登录页增加“个人密码”字段，账号分支发送 `accountPassword`；房间密码继续使用 `password`。
2. sessionStorage 有有效会话时继续走 session 分支，不要求个人密码或房间密码。
3. 增加 `ACCOUNT_PASSWORD_MISMATCH`、`ACCOUNT_RATE_LIMITED`、`ACCOUNT_STORE_UNAVAILABLE` 中文提示。
4. UI 明示“首次输入即注册；昵称与头像注册后不可修改”。
5. 增加注册后重登、错密码、跨 context 正确密码接管、新昵称注册、刷新自动重连 E2E。

### R0.2 收口全量测试超时抖动

**任务**

1. 复现 `agentRuntimeFlow.test.ts` 与 `socketFlow.test.ts` 在全量并行下的 `room:state` 超时。
2. 优先检查监听器注册时序、共享单房间/端口污染、未清理 socket/timer、异步 scrypt 与 Vitest worker 资源竞争；不得只靠无依据放大 timeout 掩盖问题。
3. 若确认仅是测试资源竞争，固定文件级串行/worker 配置或为等待 helper 使用与真实状态转换一致的条件等待。
4. 保留单测隔离性：每个测试释放 socket、server、timer、Agent 请求和临时目录。

### R0 验收

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test -w @take-time/server
npm.cmd run test:e2e -w @take-time/client
```

- 四条标准命令连续两轮通过。
- 全量服务端测试无等待超时和开放句柄。
- 无 API key 时纯真人流程与脚本 Agent 回归通过。

## 6. R1：M9.4 并发安全正式收口

### 涉及文件

- `server/src/game/handoff.ts`
- `server/src/game/actions.ts`
- `server/src/agent/runtime.ts`
- `server/src/agent/turnCoordinator.ts`
- `server/src/agent/telemetry.ts`
- `server/tests/actionsVisibility.test.ts`
- `server/tests/modelAgentHandoff.test.ts`
- 建议新增 `server/tests/handoffConcurrency.test.ts`

### 任务

1. 固化 handoff 结果分类：
   - `RaceLost` / `StaleTurn`：静默放弃，不 fallback、不写 memory；
   - `InvalidModelDecision`：进入统一 fallback 链；
   - `InternalInvariantError`：结构化记录并终止本次 handoff。
2. 验证每个 `GameRoom` 任意时刻只有一个活动 handoff 循环；挂起期间的新触发只设置续跑标记。
3. 两个及以上 Agent 同时参加 `turn === "race"`；获胜者落一张牌，失败者请求被取消。
4. 真人先出时取消所有 race Agent 请求；旧响应不落子、不更新 memory、不触发第二次 fallback。
5. 慢模型期间并发注入真人落子、hint 决策、retry/phase 推进，验证无重复模型调用、重复计时器和重复落子。
6. cancel 计入调用成本与 `cancelRate`，但不计入 deadline miss、fallback 或 decision failure。
7. 完成后删除问题清单中已关闭的 P0-07/P1-08，并回写旧 M9 里程碑状态。

### R1 验收

- 2–3 个 Agent 抢先手时桌面严格只有一张第一手牌。
- 真人赢 race 后，Agent telemetry 为 cancelled，memory 与桌面无 Agent 副作用。
- 人为延迟和并发 Socket 事件下，活动 handoff 循环峰值为 1。
- 相关定向测试重复运行 20 次无随机失败。

## 7. R2：M9.3 候选系统 v1

### 建议模块边界

```text
server/src/agent/candidates/
├── types.ts          # CandidateAction / CandidateEvaluation / trace
├── enumerate.ts      # cardId × segment 合法候选
├── strategy.ts       # hard filter、偏好评分、结构化放宽
├── evaluator.ts      # 确定性可见信息启发式
├── fallback.ts       # candidate-first → scripted bot
└── index.ts          # 仅接受安全视图的公开入口
```

实际文件可按实现合并，但公开依赖方向必须保持：`GameRoom → buildTurnView → candidates`，禁止反向传入房间。

### R2.1 候选枚举与严格剪枝

1. 从本座位可见手牌枚举全部 `cardId × segment(0..5)`。
2. 使用动作层可共享的确定性规则过滤非法 card/segment；不得复制一套会漂移的合法性逻辑。
3. 仅剪掉从当前可见信息可严格证明必输的动作；无法证明时必须保留。
4. 每个候选记录版本化 trace：基础分、剪枝原因、应用/放宽规则、最终排序原因。

### R2.2 SeatStrategy 约束

1. `hard_commitment` 有可执行候选时强制过滤。
2. `strong_preference`、`suggestion` 分层计分；`unresolved` 只进入解释，不参与硬过滤。
3. 规则与全部合法动作冲突时恢复游戏合法候选，并记录：
   - `relaxedStrategyRuleIds`
   - `strategyConflictReason`
   - 放宽前后候选数量
4. `custom` 在没有服务端解释器前不得成为硬约束。

### R2.3 启发式评分与模型 top-N

1. 首版评分只使用区段负载、公开颜色/已揭示数值、关卡公开条件、本座位可见手牌和本座位信念。
2. 排序必须可复现：同一安全视图、evaluator 版本和 seed 得到同一结果。
3. 将 top-N 和受控解释注入 turn prompt；模型返回的动作必须属于当前 top-N。
4. 非 top-N、格式非法、Provider 错误、超时、预算超限统一进入 fallback。
5. fallback 顺序固定为：候选第一名 → 现有脚本 bot；禁止随机落子。
6. `handoff.ts` 的最后一道 fallback 也必须从安全视图进入同一服务，避免生产存在第二套策略。

### R2 测试

- 候选入口类型和运行时测试都证明不能接收 `GameRoom`。
- 改变服务器真实隐藏牌、保持 Agent 安全视图和 seed 不变，候选集合、分数、top-N 完全不变。
- 显式承诺可追溯到来源消息；冲突不会产生空候选或卡死回合。
- 双人盲牌候选不会读取本人尚不可见的 value。
- 模型选择 top-N 外动作时稳定降级到候选第一名。

## 8. R3：隐藏信息评估与 M9.3 量化验收

### R3.1 未知牌采样

1. 从 `TurnView` 推导剩余可见牌集合和未知变量，按 `samplingSeed` 生成可能世界。
2. 双人本人盲牌、其他座位手牌和桌面暗牌统一按未知信息处理；不得用真实牌面校正采样。
3. 在采样世界中调用完全信息求解器估算候选成功率；求解器只接收采样世界，不接收真实 `GameRoom`。
4. 记录样本数、sampling seed、超时/截断状态和置信信息。
5. 设定单回合 CPU/事件循环预算；超过阈值时先降低采样或退回确定性启发式。确认主线程预算仍不足后再迁移 Worker Thread。

### R3.2 最小批量 Eval

在现有 `server/src/agentlab/` 上先完成 M9.3 所需的最小能力：

- `ScriptedSeatPolicy` 与 `HeuristicSeatPolicy` 使用完全相同的关卡和配对 `dealSeed`。
- 至少 200 局配对种子，覆盖 2/3/4 人和当前代表性关卡。
- 输出样本量、总通关率、按关卡/人数分组通关率、配对差值与 95% 置信区间。
- 报告包含 suite/evaluator 版本、deal/sampling seed 和代码配置摘要，可复跑。

### R3 验收门槛

- 启发式候选 fallback 相比当前脚本基线，配对通关率至少高 10 个百分点；若未达到，继续调整评分，不得以主观试玩代替。
- 隐藏真值不变性测试通过。
- 200 局报告能由一条标准 npm 命令生成。
- 单回合候选评估不突破事件循环预算；超预算有结构化 fallback reason。

## 9. R4：M9.2 真实 Provider 发布验收

R4 是发布轨道，可在 R2/R3 开发期间推进，但最终配置必须在 R7 前冻结。

### R4.1 契约 harness 收口

1. 标准命令自动加载根目录 `.env`，但日志永不输出 key。
2. 每个任务使用生产 deadline：turn=`min(thinkSeconds - 2.5s, 10s)`（10 秒档为 7.5 秒），discussion/retry 与生产配置一致。
3. 报告按任务独立输出 n、p50/p95/p99、Provider 错误率、非法输出率、deadline miss rate、fallback rate；综合值只作参考。
4. 区分冷启动与连续调用；发布样本量运行前冻结，每个任务不少于 30 次有效样本。
5. 确认本地、CI/验收机和 Railway 均未设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`；证书问题必须修复 CA/代理链。

### R4.2 turn 配置决策

按以下顺序比较，使用相同真实规模 fixture：

1. 当前默认 `gpt-5.4-mini + reasoning_effort=none`，分别在 `thinkSeconds=10/15` 下验证；
2. 对照组 `reasoning_effort=low`，量化质量收益与 deadline miss 代价；
3. 更快候选模型（如已验证可用的 nano 级模型）。

讨论/策略继续以 `gpt-5.4 + low` 为当前候选；RetryBrief 继续以 `deepseek-v4-flash` 为当前候选。模型 alias、规格或 Provider 行为变化后必须重跑。

### R4 发布门槛

- p95(`providerLatencyMs`) ≤ 对应任务生产 deadline。
- `deadlineMissRate` ≤ 10%。
- `fallbackRate` ≤ 10%。
- discussion/retry 结构化输出不因推理 token 截断正文。
- TLS 校验开启，样本量和成本记录完整。
- 不达标配置可保留为实验配置，但不得成为稳定默认。

## 10. R5：M9.5 Telemetry 与 Repository 边界

### R5.1 决策可复现字段

每次模型调用和最终决策通过 `attemptId + decisionId` 关联，至少记录：

- seat、phase/turn version、level、人数、Agent 数；
- provider、model/model snapshot、reasoning effort、采样参数；
- provider latency、端到端 latency、tokens、outcome、fallback reason；
- `promptVersion`、`viewSchemaVersion`、`agentStrategyVersion`、`candidateEvaluatorVersion`；
- `dealSeed`、`samplingSeed`、`evalSuiteVersion`；
- 候选列表 hash、最终动作、选择来源（model/candidate-first/scripted/cancelled）；
- applied/relaxed rule IDs、`strategyConflictReason`、memory/context version；
- attempt 最终结果。

输入只保存 hash 或明确白名单的受控快照；昵称、聊天和用户纠正文案限定采集范围。

### R5.2 Repository contract

建议新增：

```text
server/src/agent/repository/
├── types.ts
├── inMemoryAgentRepository.ts
└── schemas.ts
```

定义并测试：

- `game_attempts`
- `seat_strategies`
- `level_runs`
- `retry_briefs`
- `agent_decisions`

M9 只提供接口、schema/record 类型和内存实现。写入失败必须结构化记录并继续实时对局。

### R5.3 统一结算边界

1. 将 attempt 归档、RetryBrief、最终 telemetry 关联收口到幂等的结果 finalizer 边界。
2. 同一 attempt 重复触发只产生一份完成记录。
3. 纯真人对局可以记录 attempt 结果，但不依赖 AgentRuntime。
4. 为未来 `GameResultFinalizer`、M10 PostgreSQL 和长期关系记忆保留稳定调用点；本阶段不生成关系记忆。

### R5 验收

- 任一 Agent 决策可由 `attemptId + decisionId` 追到模型调用、候选、策略规则、fallback 和最终结果。
- 能计算策略来源可追溯率、行动与本座位策略一致率、冲突/放宽率。
- repository contract 与内存实现单测通过。
- 模拟 repository 不可用时，实时对局继续且产生结构化降级日志。
- 落库对象和日志中没有完整思维链或越权隐藏信息。

## 11. R6：M9.6 离线 Eval Harness 完善

### 任务

1. 扩展 `SeatPolicy`：`decideDiscussion` / `decideTurn` / `decideHint`。
2. 实现离线专用：
   - `ScriptedSeatPolicy`
   - `HeuristicSeatPolicy`
   - `ModelSeatPolicy`
   - `ReplaySeatPolicy`（先消费受控 fixture/归档接口，不依赖生产入口）
3. 版本化 manifest：suite、关卡、人数、各座位 policy、deal/sampling seed、prompt、model snapshot、evaluator。
4. 一条命令运行 ≥200 局，输出 JSON 结构化报告和便于评审的 Markdown 摘要。
5. 报告包含：
   - 通关率与 95% 置信区间；
   - 非法输出、fallback、deadline miss、cancel 与延迟分位数；
   - 策略来源可追溯率、行动一致率、冲突/放宽率；
   - 人类明确约定提取准确率、多 Agent 公开承诺冲突率；
   - retry memory on/off 的通关率与重复错误率。
6. 发布前安排小规模人工盲评：发言有用性、清晰度、自然度、信任感、趣味性。

### R6 验收

- 脚本、启发式和 LLM 使用配对关卡/种子，可复跑相同 case。
- harness 全程只消费 Agent 安全视图。
- 模型、prompt、memory/context 或候选评分变化时，CI/发布流程有明确重跑入口。
- 默认模型与 fallback 的发布结论都有对应版本化报告，不靠单次试玩。

## 12. R7：Agent 产品展示与 M9 总验收

### R7.1 前端最小展示

1. 大厅/对局展示每个 Agent 可公开的 `SeatStrategy` 摘要；不得展示 `privatePlan`、belief 或内部推理。
2. 显示用户可理解的状态：思考中、模型超时、候选 fallback、脚本 fallback、Provider 不可用。
3. 结果页提供最小复盘：最终动作来源、应用/放宽的公开策略、结构化失败经验。
4. 不向普通客户端发送 API key、prompt、私有 memory、其他座位隐藏牌或内部错误堆栈。

### R7.2 M9 总回归矩阵

- 阵容：1 真人+1/3 Agent、2 真人+1/2 Agent、3 真人+1 Agent、纯真人 2/3/4 人。
- 生命周期：新 attempt 隔离、同关 RetryBrief 白名单、跨关清理、退出/重连。
- 可见性：讨论无手牌、出牌无越权值、双人盲牌顺序正确。
- 并发：race、慢模型、真人抢先、hint、retry、phase 切换、取消/stale。
- 降级：无 key、Provider 错误、非法输出、超时、预算超限、repository 不可用。
- 质量：M9.3 ≥200 局报告和 R4 Provider 发布报告达标。
- 部署：Railway 单实例、移动端真机至少完成一轮真人+Agent 混合对局。

### R7 完成定义

只有同时满足以下条件，才把 M9 标记完成：

1. 标准 typecheck/build/server test/E2E 连续两轮全绿。
2. M9.4 并发验收全部通过，无重复落子或 stale 写入。
3. M9.3 fallback 达到量化门槛，且隐藏信息不穿透。
4. 至少一套真实 Provider 配置通过 R4 发布门槛。
5. M9.5 repository contract、复现 telemetry 和幂等 finalizer 通过测试。
6. M9.6 能生成版本化批量对照报告。
7. 纯真人模式不依赖 Agent、Provider 或 repository。
8. 权威架构、项目进度、README、计划和问题清单状态一致。

## 13. M10 与长期关系记忆的进入门槛

### M10 PostgreSQL 可开始的条件

- R5 repository contract 和 finalizer 边界冻结。
- retention、迁移、幂等键和数据库故障降级语义已有测试。
- 明确迁移 `progress/settings/accounts` 与新增 Agent 表的顺序。
- 实时 `GameRoom` 和进行中的 attempt 继续留在内存，不承诺重启恢复。

M10 另立实施计划，落地 PostgreSQL repository、`LevelRunMemory`/RetryBrief 跨退出恢复、已完成 attempt/策略/决策归档和数据保留策略。

### Agent 长期关系记忆可开始的条件

- M9.3–M9.5 已完成且质量可评测。
- 稳定 `playerId` 账号链路完成生产验收。
- 先通过 ADR/产品决策确定稳定 `agentProfileId` 与 persona roster。
- 按 ADR-0006 使用 `PlayerBehaviorFacts` / `AgentIdentity` / `AgentRelationshipMemory` 三层结构。
- 有用户查看、纠正、删除与关闭记忆的能力设计。

未满足以上条件前，不实现共享玩家画像或把关系记忆注入所有 Agent。

## 14. 每批改动的交付纪律

1. 每批只完成一个可验收纵切；先写失败测试，再实现，再跑定向与全量回归。
2. 保留当前工作区无关未提交改动，不做破坏性 reset/checkout。
3. 新增配置必须有安全默认、README 说明、env 测试且不泄漏密钥。
4. 新增 telemetry/schema/prompt/evaluator 必须版本化。
5. 阶段完成时同步更新本计划复选状态、`project_progress.md` 和相关问题清单；不得让代码状态长期领先文档。
6. 模型或网络不稳定不是跳过验收的理由；不达标时使用明确的实验状态和 fallback。

## 15. 执行清单

- [ ] R0：账号前端/E2E 与全仓库绿色基线
- [ ] R1：M9.4 并发/race 正式收口
- [x] R2：M9.3 候选系统 v1（实现、策略产出、摘要、契约与配对 eval 已完成；发布默认因质量门槛未通过而保持关闭）
- [x] R3：隐藏信息采样与量化验收（180 个冻结配对 seed、共 540 组策略运行；采样增益通过，候选质量未通过，结论已归档）
- [ ] R4：真实 Provider 批量发布验收
- [ ] R5：Telemetry / Repository / Finalizer 边界
- [ ] R6：离线 Eval Harness 完善
- [ ] R7：Agent 产品展示、Railway/真机与 M9 总验收
- [ ] 另立 M10 PostgreSQL 实施计划
- [ ] M9.5 后另立 Agent 长期关系记忆 ADR/计划
