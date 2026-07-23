# M9 Agent 待解决问题清单

> 状态：**active review / 仅保留未解决项**  
> 首次审查：2026-07-13  
> 最近更新：2026-07-19  
> 审查对象：[M9 Agent 实施计划](m9-agent-implementation-plan.md)  
> 上游口径：[当前架构](../docs/architecture.md) · [产品路线图](../docs/product-roadmap-prd.md) · [游戏规则](../rules.md)

## 1. 文档维护规则

本文只跟踪尚未解决或尚未通过验收的问题。问题在代码、测试和权威文档中全部收口后，直接从本文删除；实施结论保留在 M9 执行计划、架构文档、ADR、测试和项目进度中，不在这里重复归档。

截至 2026-07-19，已完成的记忆作用域、每座位 `SeatStrategy`、讨论协调、实体提取、`RetryBrief`、Provider adapter、预算、本地 M9.2 测试，以及 M9.4 的房间级单飞/race 代码缺陷已经移除。当前只保留 M9.4 正式并发验收、一个 plans 清理尾项，以及 M9.2 真实 Provider 发布验收问题。

## 2. 问题总览

| ID | 优先级 | 问题 | 当前状态 |
| --- | --- | --- | --- |
| M9.4-AC | 高 | 房间级单飞/race 主体代码已落地，但完整 Socket 并发矩阵与 20 次重复验收尚未签署 | 待正式验收 |
| P2-03 | 中 | `plans/` 仍有一个历史计划文件待确认去留 | 待清理 |
| M9.2-RV-01 | 阻塞发布 | turn 第二轮 p95 约 9012ms，仍贴近 9 秒生产模型 deadline | 待批量验证（2026-07-17 实测） |
| M9.2-RV-02 | 阻塞发布 | discussion 第二轮 3/3，但样本仍不足以签署结构化输出稳定性 | 待批量验证（2026-07-17 实测） |
| M9.2-RV-04 | 高 | harness 已具备发布维度与默认 30 次重复，真实批量报告尚未执行 | 待真实 Provider 验收 |
| M9.2-RV-05 | 阻塞发布 | 验收环境关闭 TLS 证书校验 | 待解决（2026-07-15 实测） |

## 3. M9.4 并发与 race 正式验收

房间级续跑单飞、动作错误分类、race 赢家取消在途失败者等主体代码已经落地。2026-07-19 又补上 race 延迟前后的 token/回合校验与可中止延迟，并在 `TurnCoordinator` 发起模型前校验座位资格，关闭了“赢家已落子，延迟失败者才开始调用 Provider”的缺陷；取消不会计入 deadline miss、fallback 或 decision failure。

当前剩余的是验收而非主体实现：需要在慢模型挂起期间并发注入真人落子、hint、retry/phase 推进等 Socket 事件，确认无重复模型调用、重复计时器、重复落子或 stale memory 写入，并将定向 race 测试重复运行 20 次。全部通过后删除 `M9.4-AC`。

## 4. Plans 清理尾项

### P2-03：历史计划文件待确认去留

此前隐藏的历史 Agent 计划和失效 `.gitignore` 白名单已清理。目前 `plans/2026-06-17-align-global-rules.md` 仍存在，需要确认它是否仍是未完成的现行计划。

关闭标准：如果工作已完成或被替代，删除该文件并将仍有效的架构结论迁移到权威文档；如果工作仍未完成，更新其状态、剩余任务和权威文档关系，使其符合“plans 只保留尚未完成执行计划”的约定。

## 5. M9.2 真实 Provider 首轮验收

2026-07-15 首轮曾使用以下真实路由（现已被第二轮配置替代）：

- `turn`：OpenAI / `gpt-5.4-mini`；
- `discussion`：DeepSeek / `deepseek-v4-pro`；
- `retry_brief`：DeepSeek / `deepseek-v4-pro`。

2026-07-17 第二轮候选路由为：讨论/策略 `gpt-5.4 + low`、出牌 `gpt-5.4-mini + low`、RetryBrief `deepseek-v4-flash`。第二轮 discussion 3/3、retry brief 3/3、turn 2/3；turn p95 约 9012ms，仍贴近 9 秒模型预算，因此不能签署稳定默认。

2026-07-15 首轮结果：

| Case | 结果 | 延迟 |
| --- | --- | ---: |
| `turn-basic` | 通过 | 5223ms |
| `discussion-basic` | 非法结构化输出 | 7509ms |
| `retry-brief-basic` | 通过 | 3182ms |

首轮 2/3 通过，`illegalOutputRate = 33.3%`，`providerErrorRate = 0%`，综合 p50 为 5223ms、p95/p99 为 7509ms。discussion 使用更接近生产的输入单独复测时输出结构合法，但延迟为 18573ms，说明输出和延迟存在明显波动。

### M9.2-RV-01：turn 延迟仍贴近生产 deadline

当前出牌候选为 `gpt-5.4-mini + low`，`thinkSeconds = 10` 时模型预算为 9 秒。第二轮 turn 仅 2/3 通过，p95 约 9012ms，边界余量不足。

关闭标准：使用与生产一致的 deadline 完成分任务批量测试；p95(`turn.providerLatencyMs`) 不超过实际 turn 模型预算，且 `deadlineMissRate`、`fallbackRate` 均不超过 10%。如需放宽 Agent 对局 `thinkSeconds`，必须明确产品默认值或建议值并重新验收。

### M9.2-RV-02：discussion 稳定性尚未批量签署

首轮 `discussion-basic` 未通过 JSON schema；第二轮修复推理 token 挤占输出正文后达到 3/3，但样本仍不足以估计非法输出率和长尾延迟，不能用三次成功关闭问题。

关闭标准：契约 fixture 使用与生产一致的 `DiscussionView + entitySourceContract`；批量记录 discussion 独立的非法输出率、超时率和输出 token；非法输出不会阻塞讨论，且整体 fallback/失败指标满足 M9.2 阈值。

### M9.2-RV-04：真实样本量不足

契约 harness 现已按任务输出 p50/p95/p99、错误率、deadline miss、fallback、token 使用，并区分冷启动与连续调用；真实模式默认每个 fixture 重复 30 次。由于尚未授权并执行会产生费用的真实批量调用，目前仍没有可签署的发布报告。

关闭标准：正式运行前冻结样本量与重复次数；报告标注每个任务的 `n`，覆盖冷启动和连续调用，并按任务输出 p50/p95/p99、非法输出率、Provider 错误率、deadline miss rate 和 fallback rate。不得再以每任务 1 条样本宣布通过。

### M9.2-RV-05：验收环境关闭 TLS 证书校验

本次 Node 进程检测到 `NODE_TLS_REJECT_UNAUTHORIZED=0`，HTTPS 请求没有验证服务器证书。该设置会削弱 API key 与模型请求的传输安全，也不代表正常生产网络条件。

关闭标准：确认变量来源，在本地和部署环境移除该设置或修复正确的 CA/代理证书链；恢复证书校验后重新执行最终真实 Provider 验收。不得基于 TLS 校验关闭时的结果签署发布通过。

## 6. 当前处理顺序

```text
M9.2-RV-05 恢复 TLS 校验
→ M9.2-RV-01 / 02 / 04 批量真实模型验收
→ M9.3 候选与 fallback
→ M9.4-AC（完整 Socket 并发与 20 次重复验收）
→ P2-03 plans 清理尾项
```

M9.2 真实验收问题不阻塞 M9.3 候选算法开发，但关闭前当前模型配置不得标记为稳定默认或进入发布。
