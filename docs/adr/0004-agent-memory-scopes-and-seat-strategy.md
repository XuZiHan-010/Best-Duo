# ADR-0004：分层 Agent 记忆与每座位独立策略

- 状态：Accepted
- 日期：2026-07-14
- 详细设计：[Agent 记忆系统设计](../agent-memory-system-design.md)
- 修订：ADR-0001 的持久化边界、ADR-0002 的唯一 `TeamStrategy` 相关条款

## 决策

- Agent 记忆按作用域分层，而不是把全部历史塞入模型 context：主干为 `Campaign → LevelRun → Attempt` 三级嵌套；`PlaySession` 是与 LevelRun 正交的运行期作用域（只承载软偏好，LevelRun 可跨 PlaySession 恢复）；`PersistentProfile` 留待未来。
- 当前 attempt 使用服务端外部 `AttemptMemory`，包含共享公开 observation/实体和每座位隔离的 observation、信念、行动、承诺与策略。
- 公开讨论由所有 Agent 共享；每个 Agent 独立生成并锁定自己的 `SeatStrategy`。不再使用要求所有 Agent 完全共享的唯一 `TeamStrategy`。
- 策略规则区分 `hard_commitment`、`strong_preference`、`suggestion` 和 `unresolved`，并保留来源消息 ID。
- 同关重试可以继承只含公开信息的 `RetryBrief`；旧手牌、私人信念、私人计划和完整思维链不得跨 attempt。
- 失败退出后恢复同关经验依赖持久化 `LevelRunMemory`；M10 PostgreSQL 落地前只保证同一 Node 进程内可用。
- 通关进入下一关只允许当前 PlaySession 的通用协作偏好作为软策略，不继承上一关具体分工、牌值或硬承诺。
- 跨会话用户画像、关卡答案和完整聊天长期记忆不在 M9/M10 范围。

## 理由

- 同关失败重试时完全失忆不像合作队友，但恢复全部历史会污染新发牌并增加隐藏信息和隐私风险。
- 多个 Agent 应像多个真人一样基于同一公开讨论形成各自理解；共享公开承诺不等于共享私人计划。
- 结构化 observation、实体和策略能提供来源追溯、确定性校验和候选约束，优于单纯依赖长 prompt。
- 将实时 memory 留在内存、只持久化精简 `RetryBrief`，可以避免数据库进入实时出牌关键路径。

## 后果

- `StrategyCompiler` 改为按座位工作的 `AgentStrategyPlanner`（或等价接口），输出 `SeatStrategy`。
- 候选层需要根据策略强度执行过滤和评分，并记录应用或放宽的规则 ID。
- 需要增加 `campaignId`、`playSessionId`、`levelRunId` 与 `attemptId`；人物级跨退出恢复还需要稳定 `playerId`。
- PostgreSQL 需要新增 `level_runs` / `retry_briefs`（或等价 schema），但数据库故障不得阻塞当前对局。
- 前端只展示 Agent 公开表达的策略与复盘信息，不能读取其他 Agent 的私人计划。

## 2026-07-22 实施补充

- 公共讨论编译为版本化 `PublicCoordinationContract`，再按座位投影；这不恢复唯一共享 `TeamStrategy`。
- 公开规则采用完整可执行 DSL，硬规则冲突时按规则逐项放宽并记录原因，不允许产生空候选或卡回合。
- 运行时新增派生条件状态与规则级承诺结果；RetryBrief v2 把确定性发现、契约结果、模型补充分离，模型不能重写确定性历史。
- 私人 belief 未经增益评测，不进入候选评分。
