# ADR-0001：实时状态留在内存，持久数据迁移到 PostgreSQL

- 状态：Accepted for interview build；`RetryBrief` / `LevelRunMemory` 持久化边界由 [ADR-0004](0004-agent-memory-scopes-and-seat-strategy.md) 补充
- 日期：2026-07-13

## 决策

进行中的 `GameRoom`、计时器、手牌和本局 Agent memory 继续保存在单 Node 进程内存中。跨重启或用于分析的数据逐步从 Railway Volume JSON 迁移到 PostgreSQL。

PostgreSQL 保存进度、设置、已完成 attempt、团队策略和 Agent 决策指标，但第一版不承诺进行中对局的重启恢复。

## 理由

- 实时回合需要低延迟，且当前只有一个全局房间和一个 Web 实例。
- 单独持久化 Agent memory 没有意义；服务重启后对应的手牌、桌面、timer 也已丢失。
- PostgreSQL 能为面试项目提供可查询的 Agent eval、成本、延迟、fallback 和策略复盘数据。
- 数据库不进入出牌关键路径，避免数据库抖动影响 5 秒回合。

## 后果

- Railway 从单 Web 服务 + Volume 演进为一个 Web Service + 一个 PostgreSQL Data Service。
- `progressStore` 需要抽象为 repository，并提供 JSON → PostgreSQL 的一次性迁移路径。
- 若未来要求中途恢复，必须另行设计完整 `GameRoom` 快照、timer 重建和 Socket 身份恢复。
