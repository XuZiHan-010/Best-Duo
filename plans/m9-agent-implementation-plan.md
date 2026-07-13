# M9：有记忆的协作 Agent 实施计划

> 状态：**active / 当前 M9 唯一执行计划**  
> 日期：2026-07-13  
> 上游架构：[docs/architecture.md](../docs/architecture.md)  
> ADR：[运行时与持久化](../docs/adr/0001-runtime-state-and-persistence.md) · [Agent 编排](../docs/adr/0002-agent-orchestration-and-model-routing.md) · [隐藏信息候选](../docs/adr/0003-hidden-information-candidate-evaluation.md)

## 目标

把现有脚本 Agent 升级为一个逻辑连续、遵守隐藏信息、能参与讨论并执行团队策略的 AI 队友。M9 不做长期跨局记忆，不做真人中途接管，也不引入 AgentScope/AutoGen 生产服务。

## 已有基础

- 2–4 人弹性开局与固定 4 座位。
- 房主加/撤 Agent 事件和前端入口。
- `InMemoryAgentRegistry`、脚本 Agent、`handoff.ts` 出牌/hint 循环。
- 真人与 Agent 共用 `applyPlacement` / `applyHintDecision`。
- `publicRoomState` / `privateHandForSeat` 可见性遮蔽。

## M9.0：领域模型和 attempt memory

1. 在房间状态增加 `attemptId`；每次进入新 discussion 时生成，重试/下一关/重新选关均更换。
2. 聊天消息增加 `attemptId`，构造 Agent context 时只读取当前 attempt。
3. 拆分 `DiscussionView` 与 `TurnView`；讨论视图类型上不含 `hand`。
4. 新增 `TeamStrategyDraft`、`TeamStrategy`、`AttemptAgentMemory`、`SeatAgentMemory`。
5. memory 存在服务端内存，不写 Volume；结果阶段可交给 telemetry/persistence 归档。
6. 新增 `ModelClient`、`AgentOrchestrator` 与可注入 mock，不接真实 API 即可跑通测试。

### M9.0 验收

- retry 后旧 chat、策略和私人 memory 不会进入新 attempt。
- 所有 Agent 使用同一份锁定策略，但私人 memory 彼此隔离。
- discussion view 的序列化结果不可能包含手牌。

## M9.1：讨论协调与团队策略

1. 实现 `DiscussionCoordinator`：Agent 顺序发言、冷却、最大次数、阶段结束取消。
2. Agent 输入包含关卡、现有聊天、其他 Agent 发言和策略草案，不含任何手牌。
3. 实现房间级 `StrategyCompiler`，在讨论结束前把明确共识编译成唯一 `TeamStrategy`。
4. 策略区分 `hard_commitment`、`strong_preference`、`suggestion`、`unresolved`，并保留 `sourceMessageIds`。
5. 房主提前结束讨论时取消未完成发言，使用最后一个合法策略草案完成收口。

### M9.1 验收

- 2 真人 + 1 Agent 能看到 Agent 发言并形成锁定策略。
- 多 Agent 发言不会并发重复或在 placing 后迟到写入 chat。
- 暗号冲突进入 `unresolved`，不会被误当成正式规则。

## M9.2：模型接入与实时决策

1. 安装 `openai` TypeScript SDK；分别实现 OpenAI 与 DeepSeek adapter。
2. env 按任务配置 provider/baseURL/key/model，不再使用 `claudeAgent.ts` 或 `ANTHROPIC_API_KEY`。
3. 初始候选：讨论/策略使用 `deepseek-v4-pro`；出牌使用 `gpt-5.4-mini`。
4. 把 placement 与 hint 合并为 `TurnDecision { cardId, segment, revealIntent, appliedStrategyRuleIds }`。
5. `TurnCoordinator` 先落子，进入 hint window 后消费缓存的 `revealIntent`。
6. 使用 Zod/JSON Schema 校验模型输出；非法输出进入 fallback。
7. 使用 `AbortController`，模型 deadline 比游戏 deadline 至少提前 500–1000ms。
8. attempt/phase/turn 改变时取消旧请求；旧响应不得更新 memory 或落子。

### M9.2 验收

- 默认 5 秒设置下记录 p50/p95/p99、超时和 fallback。
- 空响应、非法 JSON、错误 cardId、错误区段、429、5xx、断网均不卡房。
- 一次模型调用同时决定 placement 与 hint。

## M9.3：候选生成和兜底

1. 从 `TurnView` 枚举全部 cardId × segment 动作合法候选。
2. 只剪掉从可见信息可严格证明必输的动作。
3. 用团队策略、区段负载和公开牌信息做第一版启发式评分。
4. LLM 只允许从 top-N 候选中选择。
5. fallback：候选第一名 → 脚本 bot；不得直接随机落子。
6. 后续加入未知牌采样，并在采样世界中调用完全信息求解器估算成功率。
7. 采样求解超过事件循环预算时迁移到 Worker Thread。

### M9.3 验收

- 候选模块公开入口不能接收 `GameRoom`。
- 测试证明候选分数不随服务器真实隐藏牌变化，只随 Agent 可见信息和采样种子变化。
- fallback 明显优于当前“第一张牌放到最少牌区段”的脚本策略。

## M9.4：抢先手与并发

1. Agent 允许参加 `turn === "race"` 的第一手。
2. Agent 使用短随机思考延迟；真人或其他 Agent 先出后取消未完成请求。
3. 多 Agent 不能因并发结果产生重复落子；最终仍由动作层仲裁。
4. 记录被取消的 race 请求，但不计为决策失败。

## M9.5：Telemetry 与 PostgreSQL 准备

1. 每次请求记录 `attemptId`、seat、phase/turn version、provider、model、latency、tokens、decisionId 和 fallback reason。
2. 不记录模型完整思维链；输入视图需要脱敏或只保存 hash/受控快照。
3. 定义 `game_attempts`、`team_strategies`、`agent_decisions` schema 和 repository 接口。
4. PostgreSQL 不可用时不得阻塞实时出牌；记录错误并按降级策略继续。

## 测试矩阵

- memory：新 attempt 隔离、共享策略一致、私人 memory 隔离。
- 可见性：讨论无 hand，出牌无队友牌值/桌面暗牌值/未翻己方盲牌值。
- 调度：发言顺序、提前结束、迟到响应、多个 Agent。
- 实时：Abort、stale response、非法输出、Provider 错误、fallback。
- 决策：placement+hint 原子计划、候选限制、隐藏信息不穿透。
- 流程：1 真人+Agent、2真人+1Agent、2真人+2Agent、3真人+1Agent。
- 回归：纯真人 2/3/4 人流程不依赖任何 API key。

## 不在 M9 范围

- 跨局长期记忆或用户画像。
- 中途真人/Agent 控制权交接。
- 全 Agent 生产入口。
- 多房间、多实例和 Redis。
- AgentScope/AutoGen 生产运行时。
