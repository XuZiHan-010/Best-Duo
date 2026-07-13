# ADR-0002：使用 TypeScript 领域编排与双 Provider 模型路由

- 状态：Accepted
- 日期：2026-07-13

## 决策

- 生产链路不使用 AgentScope、AutoGen 或通用 ReAct 框架。
- 保留一个逻辑 `PlayerAgent`，内部拆分讨论、策略编译和实时出牌任务。
- DeepSeek V4 Pro 作为讨论/策略收口的初始候选；GPT-5.4 Mini 作为实时出牌的初始候选。
- hint 与 placement 合并为一次 `TurnDecision`。
- 服务端外部 memory 是事实来源，模型 context 每次按需构造。
- Provider 差异由薄 `ModelClient` adapter 吸收。

## 理由

- 游戏已有确定的服务端状态机与动作层，不需要模型自主选择工具或规划工作流。
- TypeScript 单服务可避免 Python RPC、第二套部署、跨进程 memory 和额外延迟。
- 两种模型任务画像不同，但通过唯一 `TeamStrategy` 和 attempt memory 保持同一个逻辑玩家的连续性。

## 后果

- 需要自行实现讨论调度、策略编译、deadline、取消、fallback、telemetry 和 eval。
- 模型名称是可配置默认值而不是永久架构承诺；未通过 eval 时可以替换。
- AgentScope 仅保留为未来离线模拟与研究工具候选。
