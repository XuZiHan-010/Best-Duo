# Agent 记忆系统设计

> 状态：**当前目标设计 / 尚未实现**
> 日期：2026-07-14
> 上游架构：[architecture.md](architecture.md)
> 实施计划：[M9 Agent 实施计划](../plans/m9-agent-implementation-plan.md)
> 决策记录：[ADR-0004](adr/0004-agent-memory-scopes-and-seat-strategy.md)

## 1. 目标

Agent 必须能够把公开讨论转化为自己出牌时可执行、可追溯的规则，并在同一关失败重试时保留公开经验。记忆系统同时满足：

- **连续性**：Agent 记得当前 attempt 中看过、说过和做过的事情。
- **可执行性**：讨论结论不是一段自由文本，而是带强度和来源的结构化 `SeatStrategy`。
- **多人隔离**：公开讨论共享；每个 Agent 的私人理解、信念和行动计划按座位隔离。
- **可见性安全**：记忆只能由该 Agent 合法可见的信息生成，不能从服务端真实隐藏牌旁路取值。
- **受控继承**：同关重试可继承精简的公开经验；跨关只保留当前游玩会话中的通用协作偏好。
- **可追溯**：实体事实、承诺和策略规则都能追溯到公开消息或公开游戏事件。
- **可降级**：数据库或模型不可用时不阻塞实时出牌。

M9/M10 不实现跨日期的用户画像、关卡答案库或完整聊天长期记忆。

## 2. 核心概念

“短期记忆”和“感知/实体/策略记忆”不是同一维度：

- **短期记忆**描述生命周期，主要指一次 attempt 内的运行时记忆。
- **感知记忆**记录 Agent 合法看到的事件。
- **实体记忆**把事件抽象为玩家、区段、承诺和规则事实。
- **策略记忆**把讨论结果编译为出牌约束和偏好。
- **信念记忆**保存基于可见信息形成、允许变化的私人推断。

服务端权威 `GameRoom` 不是 Agent memory。当前轮次、桌面牌、提示数量等权威事实由安全视图实时投影，不在 memory 中维护第二份可能过期的副本。

## 3. 作用域与标识

```text
Campaign
└── LevelRun
    ├── Attempt 1
    ├── Attempt 2 (retry)
    └── Attempt N

PlaySession（正交作用域，与 LevelRun 平行，不构成包含关系）
└── SessionExperience
```

PlaySession 不是 LevelRun 的父层：LevelRun 支持失败退出后跨 PlaySession 恢复（见 §11.3），其生命周期可以长于任何一次 PlaySession。PlaySession 只承载 `SessionExperience` 软偏好，与 LevelRun 通过时间上的重叠相关联，而非层级包含。attempt 的 `identity` 同时记录二者，仅作归档关联。

| 标识 | 作用域 | 用途 |
| --- | --- | --- |
| `campaignId` | 一份全局通关进度 | 关联进度与可恢复的同关经验 |
| `playSessionId` | 一次连续游玩（与 LevelRun 正交） | 保存跨关但不跨会话的通用协作偏好 |
| `levelRunId` | 同一关的一系列连续重试 | 失败退出后恢复 `RetryBrief` |
| `attemptId` | 一次讨论、发牌、出牌和结算 | 隔离实时 memory、模型请求和决策 |
| `playerId` | 稳定真人身份 | 防止仅凭昵称错误恢复人物承诺；当前实现尚缺 |
| `agentId` | 稳定 Agent 实例 | 关联 Agent 配置和评测，不共享私人 memory |

每次重新讨论并准备发牌都创建新 `attemptId`。只有选择同一关继续重试时沿用 `levelRunId`；通关、改选其他关卡或明确重新开始时关闭旧 `levelRunId`。

## 4. 总体数据模型

```text
AttemptMemoryStore
└── AttemptMemory
    ├── identity
    │   ├── campaignId
    │   ├── playSessionId
    │   ├── levelRunId
    │   └── attemptId
    ├── shared
    │   ├── observations
    │   ├── publicEntities
    │   └── retryBriefInput?
    └── privateBySeat
        ├── privateObservations
        ├── entityBeliefs
        ├── strategyDraft
        ├── lockedSeatStrategy
        ├── currentBeliefs
        ├── ownActions
        └── pendingCommitments
```

所有写入必须携带 `attemptId + phaseVersion + turnVersion`。版本已过期的模型响应不得写 memory、生成聊天或执行动作。

## 5. 感知记忆

感知记忆使用不可变事件，不直接保存模型对事件的解释：

```ts
interface AgentObservation {
  id: string;
  attemptId: string;
  phaseVersion: number;
  turnVersion: number;
  type:
    | "chat"
    | "placement"
    | "hint"
    | "card_revealed"
    | "phase_changed"
    | "result";
  visibility: "public" | { seatId: SeatId };
  sourceSeatId?: SeatId;
  payload: unknown;
  createdAt: number;
}
```

允许写入：

- 当前 attempt 的公开聊天和 Agent 公开发言；
- 桌面暗牌的公开颜色、区段、所有者和出牌顺序；
- 提示、揭示、阶段变化和公开结算；
- 该 Agent 自己合法可见的手牌及其变化；
- 该 Agent 自己做过的行动。

禁止写入：

- 其他玩家隐藏手牌；
- 未揭示桌面牌值；
- 双人局中该 Agent 尚不可见的己方盲牌值；
- 服务端求解器使用的真实隐藏牌面；
- 模型完整思维链。

公开 observation 可由所有 Agent 读取；私有 observation 只能由目标座位读取。讨论阶段的 `DiscussionView` 类型上不包含任何手牌字段。

## 6. 实体记忆

实体记忆从 observation 中提取讨论产生的语义事实，不复制 `GameRoom` 已经权威维护的事实。

首版实体类型：

- `seat`：某座位公开表达的职责、偏好和承诺；
- `segment`：某区段的公开分工、期望属性和未解决冲突；
- `commitment`：谁承诺在什么条件下做什么；
- `strategy_rule`：可进入策略编译的规则候选。

```ts
interface MemoryFact {
  id: string;
  attemptId: string;
  entityType: "seat" | "segment" | "commitment" | "strategy_rule";
  entityId: string;
  attribute: string;
  value: unknown;
  certainty: "explicit" | "inferred" | "conflicted";
  sourceObservationIds: string[];
  updatedAt: number;
}
```

约束：

- `MemoryFact` 只承载公开、已验证的事实，不存在私有 MemoryFact；私人推断一律使用 `AgentBelief`（§9），写入对应座位的 `entityBeliefs`，不能回写为共享事实。
- 没有 `sourceObservationIds` 的事实不得提升为公开承诺或硬策略。
- 多条消息含义冲突时标记 `conflicted`，不得静默选择其中一条。
- LLM 只负责提出结构化实体候选；实体提取由讨论发言调用顺带产出（同一次模型调用返回发言与实体候选），不增加独立调用；服务端使用 schema、可见性和来源引用进行校验。

## 7. 每座位策略记忆

公开讨论是共享输入，但每个 Agent 像真人一样独立理解并生成自己的 `SeatStrategy`。系统不维护要求所有 Agent 完全共享的唯一 `TeamStrategy`。

```ts
interface SeatStrategy {
  attemptId: string;
  seatId: SeatId;
  version: number;
  status: "draft" | "locked";
  rules: StrategyRule[];
  privatePlan: string[];
}

interface StrategyRule {
  id: string;
  type:
    | "segment_assignment"
    | "avoid_segment"
    | "card_property_preference"
    | "placement_order"
    | "hint_policy"
    | "custom";
  strength:
    | "hard_commitment"
    | "strong_preference"
    | "suggestion"
    | "unresolved";
  targetSeatIds: SeatId[];
  targetSegments?: number[];
  parameters: Record<string, unknown>;
  sourceMessageIds: string[];
}
```

策略优先级固定为：

```text
服务端游戏规则
> 人类明确达成的公开约定
> Agent 对讨论的合理推断
> Agent 自己的启发式偏好
```

讨论结束时，每个 Agent 基于当时已有的公开讨论自动生成并锁定自己的 `SeatStrategy`，不增加房主审批或编辑步骤。讨论不足时锁定空策略并使用启发式；冲突内容进入 `unresolved`。

进入禁沟通阶段后：

- 锁定的公开承诺不可被模型静默改写；
- 私人信念可随公开行动更新；
- `privatePlan` 不得被其他 Agent 读取；
- Agent 可标记承诺已完成或因客观原因无法完成，但必须记录原因。

## 8. 从策略到出牌约束

策略不能只作为 prompt 文本依赖模型自觉遵守：

```text
服务端生成合法动作
→ hard_commitment 约束候选
→ strong_preference / suggestion 参与评分
→ LLM 仅从 top-N 中选择
→ 动作层再次校验游戏规则
→ 记录 applied / relaxed strategy rule ids
```

- `hard_commitment`：在至少存在可执行候选时强制过滤；若与服务端游戏规则或全部合法动作冲突，游戏合法性优先，记录结构化 `strategy_conflict`，不得卡住回合。
- `strong_preference`：显著影响候选评分，但不删除所有合法动作。
- `suggestion`：轻度影响评分。
- `unresolved`：只进入上下文说明，不参与强制过滤。
- 只有服务端已支持并能确定性解释的结构化 rule type 才能成为 `hard_commitment`；自由文本 `custom` 在没有对应解释器前最多只能是 `suggestion` 或 `unresolved`。

模型决策需要返回 `appliedStrategyRuleIds`；若规则被放宽，还要记录 `relaxedStrategyRuleIds` 和原因，供 UI 复盘与 eval 使用。

## 9. 信念、行动与承诺

信念不是事实，必须与公开实体记忆分开：

```ts
interface AgentBelief {
  id: string;
  attemptId: string;
  seatId: SeatId;
  subject: string;
  hypothesis: string;
  confidence: number;
  evidenceObservationIds: string[];
  updatedAt: number;
}
```

- 信念只能基于该 Agent 合法可见的 observation。
- 两个私有信念桶的划分标准：`entityBeliefs` 存对实体的推断（某玩家/座位的行为习惯、某承诺的可信度）；`currentBeliefs` 存对局势的推断（未知牌分布、各区段达成条件的概率）。一条推断归属哪个桶由推断对象决定，不得两处重复存放。
- 未知牌评估使用概率/采样世界，不得读取真实隐藏牌。
- `ownActions` 保存已执行动作和关联策略规则。
- `pendingCommitments` 保存尚未履行的本座位承诺，并在行动后更新状态。

## 10. Context 构造

Memory 是服务端保存的结构化事实来源；LLM context 是单次调用的受控投影，不等于完整 memory。

讨论调用包含：

- 当前关卡公开规则；
- 当前 attempt 的公开聊天和实体；
- 同关重试的 `RetryBrief`；
- 该 Agent 已公开表达的内容；
- 不包含任何手牌。

出牌调用包含：

- 当前 `TurnView`；
- 本座位合法可见手牌；
- 本座位锁定的 `SeatStrategy`；
- 本座位私人信念、行动和待履行承诺；
- top-N 候选动作；
- 不包含其他 Agent 的私人计划和权限外牌值。

完整聊天可以为复盘归档，但实时 context 默认使用结构化实体、策略和最近关键事件；需要追溯时再通过来源 ID 取回有限原文。

## 11. 重试、退出与跨关继承

### 11.1 同一 attempt 的临时断线

只要权威 `GameRoom` 仍在，保留完整 `AttemptMemory` 并按现有重连身份恢复。当前架构仍不承诺 Railway 重启后恢复进行中的对局。

### 11.2 同关失败后重试

结果阶段生成只含公开信息的 `RetryBrief`：

```ts
interface RetryBrief {
  sourceAttemptId: string;
  levelId: string;
  publicStrategySummary: StrategyRule[];
  publicCommitments: string[];
  passedSegments: number[];
  failedSegments: number[];
  lessons: Array<{
    description: string;
    confidence: number;
    sourceIds: string[];
  }>;
  unresolvedIssues: string[];
  userCorrections: string[];
}
```

公开性过滤规则：`publicStrategySummary` 仅收录 `sourceMessageIds` 全部指向公开消息、且强度为 `hard_commitment` 或 `strong_preference` 的规则；`privatePlan`、私人信念与仅由私人推断支撑的规则永不进入 brief。

`lessons` 由结果阶段一次独立模型调用生成（无实时压力），该调用计入每 attempt 成本预算；生成失败时退化为只含确定性字段（通过/失败区段、公开承诺）的 brief，不阻塞重试。

新 attempt 只把 `RetryBrief` 作为讨论参考，不恢复旧手牌、私人信念、私人计划、候选动作或模型思维链。旧策略必须重新讨论和锁定，不能自动成为新 attempt 的硬约束。

### 11.3 失败退出后再次回来

目标行为是恢复同一 `campaignId + levelRunId` 下最近的 `RetryBrief`，使 Agent 能说明“上次哪里失败、采用过什么公开策略”。这需要持久化 `LevelRunMemory`：

```ts
interface LevelRunMemory {
  campaignId: string;
  levelRunId: string;
  levelId: string;
  status: "open" | "cleared" | "abandoned";
  retryBriefs: RetryBrief[];
  accumulatedLessons: string[];
  updatedAt: number;
}
```

在 PostgreSQL 落地前，只能保证同一 Node 进程内恢复；M10 持久化完成后才承诺跨退出和 Railway 重启恢复。首版最多保留同一 `levelRunId` 最近 3 次 `RetryBrief`。

### 11.4 通关进入下一关

关闭旧 `levelRunId`，不把上一关具体分工、区段规则、牌值、信念或承诺带入下一关。当前 `playSessionId` 内可以保留软性的 `SessionExperience`：

- 沟通和发言偏好；
- 分工方式偏好；
- 提示使用风格；
- Agent 已被用户纠正的通用行为。

这些经验只能作为 `suggestion` 或 `strong_preference`，不能成为新关卡的硬约束。PlaySession 结束后默认清除，不跨日期持久化。PlaySession 结束的可操作判定：所有真人座位断开连接持续超过 30 分钟，或服务器进程重启（内存态自然清空）；二者任一发生即视为结束并清除 `SessionExperience`。

### 11.5 真正长期记忆

跨会话的用户画像、伙伴 Agent 记忆、历史关卡解法和完整聊天不在 M9/M10 范围。未来若实现，必须提供用户选择、查看、纠正和删除能力，并默认禁止保存具体牌面与关卡答案。

## 12. 归属、身份与多人隔离

- 公开 observation、公开实体和 `RetryBrief` 归属 `levelRunId`。
- `SeatStrategy`、私人 observation、信念和计划归属 `attemptId + seatId`。
- 需要恢复“某个真人的个人承诺”时必须有稳定 `playerId`；昵称不能作为身份键。
- 当前单房间私用原型在缺少 `playerId` 时，只持久化公开关卡经验，不跨退出恢复人物画像或人物承诺。字段级降级：跨退出恢复的 `RetryBrief` 必须剥离 `publicCommitments` 与 `userCorrections`（人绑定字段），仅保留 `passedSegments`、`failedSegments`、`lessons` 与 `unresolvedIssues`。
- Agent 被撤下后，其私人 memory 立即失效；重新加入的新 Agent 不继承旧 Agent 私人计划。

## 13. 持久化与故障策略

| 数据 | 存储 | 是否进入新 context |
| --- | --- | --- |
| 当前 `AttemptMemory` | Node 内存 | 当前 attempt 按权限进入 |
| `RetryBrief` / `LevelRunMemory` | PostgreSQL 目标；落地前仅内存 | 仅同关 retry |
| `SessionExperience` | Node 内存 | 仅当前 play session，软偏好 |
| 已完成 attempt、策略、决策指标 | PostgreSQL | 默认不进入，只用于复盘/eval |
| 完整聊天 | 默认不持久化；按需启用 | 不默认进入 |
| 模型思维链 | 不保存 | 永不进入 |

数据库不可用时：

- 当前对局和实时出牌继续；
- 内存中的 attempt memory 继续更新；
- `RetryBrief` 持久化失败记录结构化错误；
- UI 明确提示本次失败经验可能无法在退出后恢复；
- 禁止数据库调用进入实时出牌关键路径。

## 14. 测试与验收

### 14.1 生命周期

- 新 attempt 不读取旧 chat、手牌、私人信念或私人策略。
- 同关 retry 只读取受控 `RetryBrief`。
- 下一关不读取上一关的分工和硬规则。
- LevelRun 持久化后，失败退出再回来能恢复公开经验。

### 14.2 可见性

- `DiscussionView` 序列化永远不含手牌。
- A 座位 memory API 不能读取 B/C/D 的私有 observation、belief 或 private plan。
- 改变服务端真实隐藏牌但保持 Agent 可见视图不变时，memory、候选评分和决策输入不变。

### 14.3 策略一致性

- 每个 Agent 基于相同公开讨论生成独立 `SeatStrategy`。
- 明确公开承诺可追溯到 `sourceMessageIds`。
- 冲突讨论进入 `unresolved`，不参与硬过滤。
- 决策记录能说明应用、放宽或违反了哪些策略规则及原因。

### 14.4 并发和过期响应

- attempt/phase/turn 变化后，旧响应不能写 observation、实体、策略或行动。
- 多 Agent 同时决策时只能写自己的私人 memory。
- race 中被取消的请求不更新 memory。

### 14.5 质量指标

- 策略来源可追溯率；
- 私人行动与自身 `SeatStrategy` 一致率；
- `strategy_conflict` 与规则放宽率；
- retry memory 启用/关闭时的通关率与重复错误率；
- context token、延迟、超时和 fallback 分位数。

## 15. 分阶段落地

### M9.3 review v2 已落地口径

- `AttemptMemory.shared.publicContract` 保存当前 attempt 唯一公开契约；每座位仍只读取自己的策略和私人 memory 投影。
- `PendingCommitment` 绑定稳定 `ruleId`，状态为 `pending / fulfilled / impossible / relaxed`；动作采用或放宽规则时由确定性代码更新。
- `TurnView.memory.derivedState` 每回合从公开视图重算条件与承诺状态，不复制 `GameRoom` 隐藏真值。
- `RetryBrief` 将确定性发现、契约结果和模型教训分字段保存；兼容 `lessons` 是确定性发现与模型补充的渲染投影，模型只允许追加 `modelLessons`。
- `value-belief-v2` 是每座位私有的回合派生态：只读安全 `TurnView`，将物理可能值与成功条件兼容值分开，保留 `inconsistent` 状态，并记住该 Agent 落子时合法可见的己方牌值。它已接入候选的共享区段补位评分和保守 `belief_signal`；不持久化、不跨 attempt，也不读取其他座位私有信息。

1. **M9.0**：`attemptId`、安全视图、Observation/Entity/SeatStrategy 类型与内存 Store。
2. **M9.1**：讨论调度、实体提取、每座位策略生成和锁定、同进程 `RetryBrief`。
3. **M9.2–M9.4**：实时决策、策略约束候选、信念更新、过期写保护和并发。
4. **M9.5–M9.6**：telemetry、memory/策略质量指标与离线 eval。
5. **M10**：PostgreSQL repository、`LevelRunMemory` 跨退出恢复和数据保留策略。
6. **后续可选**：用户授权的伙伴型长期记忆；不属于当前承诺。
