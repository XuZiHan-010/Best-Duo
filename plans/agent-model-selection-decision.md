# Agent 选型定案（2026-06 探讨稿的收口决议）

> 状态：**accepted decision record，已由 2026-07-13 架构收口补充**。模型是初始生产候选而不是未经评测的永久默认。现行架构见 [Agent 编排 ADR](../docs/adr/0002-agent-orchestration-and-model-routing.md)，执行见 [M9 实施计划](m9-agent-implementation-plan.md)。

## 决议一览

| 遗留项 | 决议 |
| --- | --- |
| Provider 终选 | **OpenAI + DeepSeek 双家组合**（不再以 Claude 为基线） |
| 讨论发言档模型 | **DeepSeek V4 Pro**（`deepseek-v4-pro`） |
| 出牌快档模型 | **GPT-5.4 Mini**（placement 与 hint 合并为一次 `TurnDecision`） |
| 脚本 bot 定位 | **仅内部兜底**，不暴露为难度档 |
| 方案 D（LLM+候选评估） | **分阶段纳入**：先安全候选与启发式评分，再做基于可见信息的信念采样 |

---

## 1. Provider：OpenAI + DeepSeek 组合

**工程形态**：DeepSeek 的 API 为 OpenAI 兼容格式，两家可以共用同一个 `openai` SDK，每个决策档只是一组 `{baseURL, apiKey, model}` 配置的差别。项目仍保留薄 `ModelClient` 接口来隔离配置、结构化输出、usage、错误与取消语义，不引入重量级框架。

**按选型稿五维度的对比结论**（数据核实日期 2026-07-10）：

| 维度 | OpenAI | DeepSeek |
| --- | --- | --- |
| 结构化输出 | strict json_schema 全线支持，返回格式有硬保证 | JSON output + tool calls，非 strict；返回体极小（`{cardId, segment}`），JSON mode + 服务端校验 + 兜底足够 |
| 快档价格/延迟 | GPT-5.4 Nano $0.20/$1.25、Mini $0.75/$4.50，延迟稳定 | V4 Flash $0.14/$0.28（缓存命中 $0.0028），最便宜；高峰期延迟有波动 |
| 强档中文发言 | GPT-5.5 $5/$30 | **V4 Pro 官方现价：缓存未命中输入 $0.435/M、输出 $0.87/M**；中文质量仍需项目盲评 |
| TS SDK 契合 | openai SDK 原生 | 同一个 openai SDK，换 baseURL 即可 |
| 隐藏信息推理 | 需实测 | 需实测 |

**成本口径修正**：3 Agent 满编只能出现在 4 人局，每个 Agent 3 张牌，因此最多是 **9 次 Agent 出牌决策**，不是 18 次。hint 合并后不再追加 9 次模型请求。成本评估必须同时报告全未缓存上界和实际 usage，不预先假定缓存命中。

**代价与共识**：
- 维护两个 API key（若日后想只管一个 key，"全 DeepSeek：Pro 讨论 + Flash 快档"是成立的备选路线）。
- DeepSeek 非 strict 输出、高峰延迟波动 → **服务端合法性校验 + 超时/格式兜底不可省**（选型稿已规划，维持）。
- `deepseek-chat` / `deepseek-reasoner` 旧模型名 **2026-07-24 起弃用**，一律使用新名 `deepseek-v4-flash` / `deepseek-v4-pro`。

## 2. 按任务分档：谁干什么活

### 讨论发言（`decideDiscussion`）→ DeepSeek V4 Pro

任务画像：低频、输出为自由中文（策略建议/分工协调/条件解读）、窗口最宽（`discussionMinutes` 5–20 分钟级）、是"AI 队友"体验的门面，无结构化输出需求。

- 选 DS V4 Pro 的理由：中文表达最自然（决定性维度）；可开 thinking 模式（窗口宽，耗时无所谓）；价格约 GPT-5.5 的 1/8。
- 排除项：GPT-5.5（贵 8 倍、中文自然度略逊）；省钱档 Flash/Nano（发言空洞模板化，砸核心体验，此任务不省钱）。
- 已知短板：高峰延迟波动——讨论窗口宽，基本无感。

### 出牌决策（`decidePlacement`）→ GPT-5.4 Mini

任务画像：高频（3 Agent 满编一局最多 9 次）、硬窗口 `thinkSeconds`（5–30 秒，默认 5 秒）、输出极小但**正确性要求最高**（同时满足关卡条件、全局规则，并从桌面暗牌颜色与讨论记录做心智推理）；放错一张可能直接输局。实时出牌任务的“推理密度/延迟预算”比值最苛刻。

- 选 Mini 的理由：推理明显强于 Nano（放错牌的代价 > 几美分差价）、延迟稳、strict json_schema 几乎不触发格式兜底。
- 备选：GPT-5.4 Nano（降档，若实测 Mini 正确率与之无差）；DS V4 Flash 非思考（"全 DeepSeek 单 key"路线备选，缓存红利大，但高峰延迟 × 5 秒硬窗口 = 兜底触发率不可控）。
- 排除项：DS thinking 档 / V4 Pro——thinking 耗时大概率撑破 5 秒窗口，不能把产品参数（thinkSeconds）绑架给模型。

### 提示决策 → 合并到出牌响应

hint 是出牌策略的一部分。出牌响应同时返回 `revealIntent`，服务端落子后在 hint window 消费该意图；不再为 hint 发起第二次网络请求。若结构化响应缺少或非法，安全默认值为 `"no"`。

### 分档默认值汇总（env 可覆盖，实测后可改）

| 任务 | 默认模型 | 备选 | 每局成本粗估 |
| --- | --- | --- | --- |
| 讨论发言 | DeepSeek V4 Pro | GPT-5.4 | ~$0.01–0.03 |
| 出牌 | GPT-5.4 Mini | GPT-5.4 Nano / DS V4 Flash | ~$0.03–0.05 |
| hint | 复用出牌结果 | 非法/缺失时默认 `no` | 无额外模型调用 |

## 3. 脚本 bot：仅内部兜底

无 API key / 超时 / 报错时先回落到候选评分第一名，再以脚本 bot（`server/src/agent/scriptedAgent.ts`）作极端兜底。脚本 bot **不暴露为可选难度档**；但 fallback 必须写 telemetry，前端可显示非干扰性的“AI 已使用备用策略”状态，不能让运维侧无感知。

## 4. 方案 D 分阶段纳入：安全候选 + 概率评估 + LLM 最终选择

`server/src/game/solver.ts` 是完全信息求解器，而 agent 只见自己手牌 + 桌面暗牌**颜色**，因此混合形态不是"求解器直接给答案"，而是分工：

1. **规则层 = 动作合法候选生成器**：从 `TurnView` 枚举 cardId × segment，并排除动作层立即拒绝的选择。
2. **候选评估器 = 安全剪枝与概率评分**：只剪掉从可见信息可以严格证明必输的动作；后续通过符合公开信息的未知牌采样，在采样世界中复用完全信息求解器。
3. **LLM = 最终选择**：在 top-N 内结合锁定的 `TeamStrategy`、桌面颜色和私人 memory 选择。
4. **兜底链**：LLM 失败/超时 → 候选第 1 名 → 脚本 bot。

选型稿中"D 列为日后升级路径"的表述相应作废。

## 5. 维持不变的原稿结论

- 大脑技术以 C（LLM）为主，D 作为出牌环节的增强形态并入。
- 讨论发言必须接线：`decideDiscussion` 的服务端调用点缺失仍是关键缺口（讨论计时窗口内调用 → `kind:"agent"` 注入 `room.chat` → 广播，不走 `chat:send` 入站）。
- `PlayerAgent` 作为领域 façade 保持 Provider 中立；底层按讨论、策略编译和实时出牌任务分别配置模型。
- 模型 deadline 小于游戏 deadline，使用 `AbortController` 真正取消请求；`Promise.race` 只放弃等待但不取消底层请求，不能作为完整方案。

## 后续待办（本轮不执行）

1. **文档同步**：已由 [当前架构](../docs/architecture.md)、ADR 与新版 M9 计划收口；本文件保留为模型决策记录。
2. **实测清单**（选型的验证口径随决议更新）：
   - GPT-5.4 Mini：出牌决策在 5 秒窗口内的真实延迟与 4–13 关出牌正确率（对照 Nano）。
   - DeepSeek V4 Pro：讨论发言中文质量抽查（对照 GPT-5.4）。
   - 遮蔽穿透抽查、讨论发言闭环、兜底不卡房——沿用原稿验证项。
3. **M9 实现规划**：见 [m9-agent-implementation-plan.md](m9-agent-implementation-plan.md)。

## 数据来源

- [DeepSeek Models & Pricing（官方文档）](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek API Pricing July 2026](https://www.tldl.io/resources/deepseek-api-pricing)
- [OpenAI API Pricing（官方文档）](https://developers.openai.com/api/docs/pricing)
- [OpenAI 2026 模型价格汇总](https://www.aipricing.guru/openai-pricing/)
