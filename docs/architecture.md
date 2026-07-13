# Take Time 当前架构与演进目标

> 状态：**当前架构权威文档**  
> 更新日期：2026-07-13  
> 游戏机制以 [rules.md](../rules.md) 为准；产品范围以 [product-roadmap-prd.md](product-roadmap-prd.md) 为准；执行步骤见 [M9 Agent 实施计划](../plans/m9-agent-implementation-plan.md)。历史双人设计见 [take-time-web-prototype.md](take-time-web-prototype.md)，不再作为现行架构口径。

## 1. 系统边界

Take Time 是部署在 Railway 上的单房间、2–4 人实时合作谜题游戏：

- 前端：Vite + React + TypeScript。
- 后端：Express + Socket.IO + TypeScript。
- 共享层：`shared` 维护前后端共用状态、事件与关卡类型。
- 当前实时状态：单 Node 进程内的唯一 `GameRoom`。
- 当前持久化：Railway Volume 上的进度与设置 JSON。
- 目标持久化：PostgreSQL 保存进度、已完成 attempt、团队策略与 Agent 决策指标；进行中的对局仍留在内存。
- LLM：OpenAI + DeepSeek 双 Provider；所有密钥只存在服务端环境变量。

当前仍保持单 Web 实例。引入 PostgreSQL 后，Railway 拓扑变为“一个 Web Service + 一个 PostgreSQL Data Service”，而不是把实时房间改成数据库驱动。

## 2. 房间、座位与开局

- 房间固定 4 个座位，`capacity` 表示房间上限并恒为 4，不再是房主选择的开局人数。
- 实际就位人数可以是 2、3 或 4，发牌按开局时 `occupiedSeats.length` 决定。
- 至少需要 1 名真人；所有真人均已准备时可以开局，Agent 座位视为已就绪。
- 第一个准备的真人成为房主；房主负责设置、选关、开始、重试和推进。
- 座位统一使用 `Seat { id, kind, nick, agentId?, connected }`，真人与 Agent 进入同一动作层。

## 3. 牌库、发牌和可见性

- 固定牌库 24 张：白色 1–12、黑色 1–12。
- 每次 attempt 随机抽取 12 张，先通过 `solver.ts` 验证至少存在一个完整解，无解则重抽。
- 2 人：每人 6 张，使用双人盲牌规则。
- 3 人：每人 4 张，手牌全部对本人可见。
- 4 人：每人 3 张，手牌全部对本人可见。
- 桌面暗牌颜色公开、数值隐藏；提示标记翻开的牌公开颜色与数值。
- 服务端通过 `publicRoomState` 与 `privateHandForSeat` 构造视图，前端和 Agent 都不能接触权限外的隐藏牌值。

`centerCap` 的统一语义为：省略或 `null` = 默认 24；数字 = 对每个区段生效的上限；`"inf"` = 无上限。

## 4. 状态机和动作层

主状态机：

```text
waiting → levelSelect → discussion → placing → reveal → result
```

服务端是唯一权威状态来源：

- Socket handler 只负责身份、阶段和 payload 校验，再调用动作层。
- 真人与 Agent 都调用 `applyPlacement` / `applyHintDecision`，不各自实现游戏规则。
- `phaseVersion` / `turnVersion` 防止旧计时器和旧异步结果污染新状态。
- 第一手为抢先手；之后按实际就位座位顺序循环。
- 进行中的对局不承诺在 Railway 重启后恢复。

## 5. Attempt 边界

每次进入新的讨论阶段并准备重新发牌时创建新的 `attemptId`。以下数据都必须绑定 `attemptId`：

- 当前讨论消息；
- 团队策略草案与锁定策略；
- 每个 Agent 的私人 memory；
- Agent 模型请求与决策；
- 数据库对局与评测记录；
- 尚未完成的 AbortController。

重试、下一关、重新选关后均创建新 attempt。旧数据可以归档用于复盘和评测，但不得进入新一局的 LLM context。

## 6. Agent 架构

生产链路使用项目内的 TypeScript 领域编排，不引入 AgentScope、AutoGen 或通用 ReAct 循环。原因是游戏流程固定、服务端必须掌握阶段和动作权威，并且默认出牌窗口只有 5 秒。

```text
AgentOrchestrator
├── DiscussionCoordinator
├── StrategyCompiler
├── TurnCoordinator
├── AttemptMemoryStore
├── CandidateGenerator / CandidateEvaluator
├── DeadlineController
├── ModelClient
│   ├── OpenAIModelClient
│   └── DeepSeekModelClient
└── AgentTelemetry
```

Agent 是一个逻辑玩家，但按任务使用不同模型：

- 讨论与策略收口：初始候选为 DeepSeek V4 Pro。
- 实时出牌：初始候选为 GPT-5.4 Mini，使用 `none/low` reasoning effort。
- hint：与出牌合并为同一次 `TurnDecision`，不再单独调用 LLM。
- 模型选择属于可配置的初始候选，必须通过项目 eval 后才能成为稳定默认。

### 6.1 讨论与策略

讨论模型只接收不含手牌的 `DiscussionView`。Agent 按顺序参与讨论，读取当前关卡、真人发言、其他 Agent 发言和策略草案。

讨论结束时，由房间级 `StrategyCompiler` 生成唯一的 `TeamStrategy`。所有 Agent 使用同一份团队策略；每个 Agent 另有不共享的 `SeatAgentMemory` 保存自身行动和局势判断。

### 6.2 实时决策

出牌模型接收 `TurnView`：遮蔽后的房间状态、自己的可见手牌、锁定的团队策略、私人 memory 与候选动作。一次响应同时返回：

```ts
interface TurnDecision {
  cardId: string;
  segment: number;
  revealIntent: "yes" | "no";
  appliedStrategyRuleIds: string[];
}
```

模型请求 deadline 必须小于游戏 deadline；默认 5 秒回合中，模型预算约 3.5–4 秒。使用 `AbortController` 取消请求，不能只靠 `Promise.race` 放弃等待。

### 6.3 候选与隐藏信息

- 规则层生成动作合法候选。
- 只剪掉从 Agent 可见信息即可严格证明必输的候选。
- 高胜率排序必须基于可见信息、讨论策略和对未知牌的信念采样；不得使用服务器真实隐藏牌做排序。
- 完全信息求解器只能运行在采样出的可能世界中，不能直接用真实 `GameRoom` 为 Agent 提示答案。
- LLM 超时后采用候选评分第一名；候选评分失败后才使用脚本 bot。

## 7. Memory 与 Context

Agent memory 是服务端外部记忆，LLM context 只是每次调用时对相关记忆的临时投影。

```text
AttemptAgentMemory
├── shared
│   ├── strategyDraft
│   └── lockedStrategy
└── privateBySeat
    ├── ownActions
    ├── observations
    ├── currentBeliefs
    └── pendingCommitments
```

当前 attempt memory 与 `GameRoom` 一起保存在内存中。数据库只保存已完成或需要评测的业务记录；不保存模型完整思维链。

## 8. 持久化目标

PostgreSQL 目标表：

- `app_progress`：全局通关进度与设置。
- `game_attempts`：关卡、人数、Agent 数、开始/结束时间与结果。
- `team_strategies`：锁定的结构化策略及版本。
- `agent_decisions`：模型、延迟、token、候选、选择和 fallback reason。
- `chat_messages`：仅在需要完整回放时启用。

数据库不可用不得阻塞 5 秒出牌关键路径。是否允许在数据库故障时继续对局，需要在持久化实施计划中明确；第一版可允许继续实时对局并记录结构化错误。

## 9. 部署与扩展边界

- Web 实例固定为 1；当前 Socket.IO 不需要 Redis Adapter 或 sticky session。
- PostgreSQL 负责持久数据，不负责实时回合协调。
- 若未来引入多房间或多 Web 实例，必须重新设计房间路由、共享实时状态、Socket.IO Adapter 和定时器归属。
- AgentScope 可作为未来离线 `agent-lab` 的候选，用于批量模拟和评测；不进入实时生产链路。

## 10. 横向质量要求

- 可见性：任何 Provider 请求都不能包含 Agent 权限外的牌值。
- 实时性：记录 p50/p95/p99、超时率与 fallback 率。
- 可回归：每次人数、Agent 或接管能力扩展都补服务端、Socket 和 E2E 测试。
- 可观测：日志关联 `attemptId`、`seatId`、`phaseVersion`、`turnVersion`、provider、model 和 decisionId。
- 可复现：生产尽量锁定模型 snapshot；模型 alias 变更必须重新跑 eval。
- 隐私：聊天和昵称发送给第三方 Provider 的范围、保留和日志策略需要在部署说明中公开。
