# Take Time 当前架构与演进目标

> 状态：**当前架构权威文档**  
> 更新日期：2026-07-21
> 游戏机制以 [rules.md](../rules.md) 为准；产品范围以 [product-roadmap-prd.md](product-roadmap-prd.md) 为准；Agent 记忆细节以 [Agent 记忆系统设计](agent-memory-system-design.md) 为准；剩余执行步骤见 [Agent 剩余开发执行计划](../plans/2026-07-18-agent-remaining-development-plan.md)，已完成里程碑与历史验收见 [M9 Agent 实施计划](../plans/m9-agent-implementation-plan.md)。历史双人设计见 [take-time-web-prototype.md](take-time-web-prototype.md)，不再作为现行架构口径。

## 1. 系统边界

Take Time 是部署在 Railway 上的单房间、2–4 人实时合作谜题游戏：

- 前端：Vite + React + TypeScript。
- 后端：Express + Socket.IO + TypeScript。
- 共享层：`shared` 维护前后端共用状态、事件与关卡类型。
- 当前实时状态：单 Node 进程内的唯一 `GameRoom`。
- 当前持久化：Railway Volume 上相互独立的进度/设置 JSON、schema v2 账号 JSON 与管理员账号审计 JSONL。
- 目标持久化：PostgreSQL 保存进度、已完成 attempt、每座位策略、同关重试摘要与 Agent 决策指标；进行中的对局仍留在内存。
- LLM：OpenAI + DeepSeek 双 Provider；所有密钥只存在服务端环境变量。

当前仍保持单 Web 实例。引入 PostgreSQL 后，Railway 拓扑变为“一个 Web Service + 一个 PostgreSQL Data Service”，而不是把实时房间改成数据库驱动。

## 2. 房间、座位与开局

- 房间固定 4 个座位，`capacity` 表示房间上限并恒为 4，不再是房主选择的开局人数。
- 实际就位人数可以是 2、3 或 4，发牌按开局时 `occupiedSeats.length` 决定。
- 至少需要 1 名真人；所有真人均已准备时可以开局，Agent 座位视为已就绪。
- 第一个准备的真人成为房主；房主负责设置、选关、开始、重试和推进。
- 座位统一使用 `Seat { id, kind, nick, agentId?, connected }`，真人与 Agent 进入同一动作层。

### 2.1 玩家身份与重连（ADR-0005 / ADR-0007）

- 现行后端账号实现已切换到 ADR-0007 schema v2：**未验证邮箱**是唯一日常登录标识，个人密码完成账号认证，昵称是账号级唯一、可修改的公开展示资料；头像也是可修改的公开资料，自定义图片持久化到账号记录，清空时恢复由 `playerId` 派生的默认头像。房间密码只证明“允许尝试进入房间”。旧 `player:join` 昵称隐式注册在注入正式账号仓库时被拒绝。
- 邮箱规范化后以 HKDF 派生索引密钥做 HMAC-SHA-256 查询，以独立的 HKDF 加密密钥做 AES-256-GCM 密文保存；主密钥来自 `ACCOUNT_EMAIL_KEY`。口令只存异步 scrypt 摘要且 KDF 参数随记录版本化。账号文件、密钥或 schema 异常时 fail-closed，不覆盖原文件。
- `credentialVersion` 随改密、换邮、停用、恢复与软删除单调递增；账号会话校验同时比对版本。改密/换邮先持久化，再给当前设备换发会话，旧令牌立即失效。头像/昵称修改按 `playerId` 更新当前内部座位投影，`playerId` 不进入公共 `room:state`。
- 后端已提供显式注册/登录、改名、改密、换邮、撤销其他会话，以及管理员脱敏列表、强制登出、停用/恢复、软删除与无敏感字段审计；生产前端均已接入真实 Socket。仍不提供验证码、找回、恢复密钥、邮件 Provider、Resend 或管理员重置密码/代换邮箱。
- **账号身份与座位所有权是两种独立凭证**：`account:session { playerId, accountToken }` 只授权读取和维护本人资料，不能恢复座位、读取手牌或执行游戏动作；`player:session { playerId, reconnectToken, seatId }` 只证明当前座位所有权。房间满、对局进行中、正常离座或被普通请出时，账号会话仍可继续使用。
- 账号令牌由 `server/src/auth/accountSessions.ts` 签发，服务端仅保存 SHA-256 摘要和签发时的 `credentialVersion`；刷新/重连通过 handshake `accountPlayerId + accountToken` 恢复。改密、换邮、管理员强制登出/停用/删除会撤销相应账号会话。
- 首次成功入座时服务端签发 `playerId` + 高熵 `reconnectToken`（`server/src/auth/playerSessions.ts`），经仅发给该 socket 的 `player:session` 返回；服务端只存 SHA-256 摘要。
- 重连/接管座位的唯一凭据是玩家会话：页面刷新与 transport 自动重连经 Socket.IO handshake `auth` 提交，`player:join` 也可携带 `session` 字段显式接管。每次成功附着都轮换令牌，旧令牌保留 30 秒宽限期（防客户端落盘前断网自锁）。
- 无有效会话的同昵称加入一律返回 `NICK_IN_USE`，原座位与旧连接不受影响；接管顺序固定为"先验证、附着并轮换成功，最后断开旧 socket"。
- 玩家离开、被请出、座位超时释放、房间软重置时撤销对应的**座位会话**，不等于退出账号。两类会话仓库均为纯内存（一房一仓库），进程重启后令牌失效，需重新登录并入座。
- 公共状态使用显式 `PublicSeat` 白名单（`id/kind/nick/avatar/agentId/connected`），任何凭证、socketId、管理标记都不会广播。
- 客户端把账号会话与座位会话分别存入 `sessionStorage`（同标签页有效），不进 URL、DOM 或公共调试状态；`/admin/*` 建连时不提交这两类玩家凭证，避免管理台被自动座位恢复劫持。

### 2.2 管理员强制接管（ADR-0005）

- 管理后台认证本身不占座：`admin:login { intent: "manage" }` 只建立后台会话。管理员显式执行 `admin:enterRoom` 后，空房直接入座；有真人时才要求确认强制接管。接管会终止当前游戏、请出全部在座者、撤销其座位会话并让管理员入 A 座成为房主，但普通玩家的账号资料会话仍保留。
- 凭证独立于房间密码：`ADMIN_USERNAME` + `ADMIN_PASSWORD` 环境变量，两者齐备且密码不同于 `ROOM_PASSWORD` 才启用；恒定时间比较 + 60 秒窗口 5 次失败限流；登录不需要房间密码。
- `admin:enterRoom` 三分支：管理员玩家会话仍在座 → 直接恢复；房间有真人 → 下发 `admin:enterConfirmRequired`（含 `stateVersion`）由客户端弹窗确认，选"否"零副作用；无真人 → 直接入座。`admin:seizeRoom` 必须携带确认时的 `stateVersion`，陈旧即拒绝并重发确认信息。
- 接管与对局中请出复用 `cancelDiscussion` + `clearAllTimers` + `softResetRoom`/`resetRoundState` 的清理组合，不写通关进度、不记失败，迟到的计时器与模型回调不能污染新大厅。
- 管理员可用 `admin:kickPlayer`（携带 `stateVersion`，二次确认）单点请出真人玩家；被请出者的座位会话立即失效、账号会话保留，因此这是“请出房间”而非“强制登出账号”。账号强退/停用/删除使用独立的 `admin:accounts:*` 动作并撤销两类会话。
- 管理员入座昵称在 `/admin` 登录表单单独填写（默认"管理员"），`ADMIN_USERNAME` 永不进入公共状态；管理员看不到任何其他玩家的私有手牌（接管时手牌已清空）。

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
- 局中任一在座玩家确认“结束游戏”时，`game:end` 结束当前 play session 并统一返回 `waiting`：清空关卡、手牌、计时器、聊天和本局 Agent memory，但保留真人/AI 座位、Socket 绑定及玩家会话；真人重置为未准备、AI 保持就绪、`host` 清空并由下一位准备的真人重新取得。只有主动离房、管理员请出、断线超时或房间重置才释放座位。
- 进行中的对局不承诺在 Railway 重启后恢复。

## 5. Attempt 边界

记忆与对局的主干作用域为三级：`Campaign → LevelRun → Attempt`；`PlaySession` 是与 LevelRun 正交的运行期作用域（只承载跨关软偏好 `SessionExperience`，不包含 LevelRun——LevelRun 支持失败退出后跨 PlaySession 恢复，生命周期可长于单次 PlaySession）。每次进入新的讨论阶段并准备重新发牌时创建新的 `attemptId`；同一关连续重试沿用 `levelRunId`。以下数据都必须绑定 `attemptId`：

- 当前讨论消息；
- 每座位策略草案与锁定策略；
- 每个 Agent 的私人 memory；
- Agent 模型请求与决策；
- 数据库对局与评测记录；
- 尚未完成的 AbortController。

重试、下一关、重新选关后均创建新 attempt。旧数据可以归档用于复盘和评测，但不得直接进入新一局的 LLM context。

- **同关重试**：允许继承只含公开策略、公开承诺、区段结果、用户纠正和失败复盘的 `RetryBrief`；旧手牌、私人信念、私人计划和候选动作不得继承。
- **失败退出后再回来**：目标是在同一 `campaignId + levelRunId` 下恢复最近的 `RetryBrief`；PostgreSQL 落地前只保证同一 Node 进程内有效。
- **下一关**：不继承上一关的具体分工或硬承诺；当前 PlaySession 只可携带通用协作偏好，并作为软策略使用。
- **跨会话**：关卡答案和完整聊天长期记忆不在 M9/M10 范围。Agent 长期记忆（对某个玩家的关系记忆）已定向推迟：待 M9.5 repository 边界落地后，按 [ADR-0006 决策二](adr/0006-player-accounts-and-deferred-agent-memory.md)的三层架构（`PlayerBehaviorFacts` / `AgentIdentity` / `AgentRelationshipMemory`）另立计划实施；稳定 `agentProfileId` 是其前置条件。玩家账号（稳定 `playerId`）本身已由 ADR-0006 决策一落地。

## 6. Agent 架构

生产链路使用项目内的 TypeScript 领域编排，不引入 AgentScope、AutoGen 或通用 ReAct 循环。原因是游戏流程固定、服务端必须掌握阶段和动作权威，并且默认出牌窗口只有 10 秒。

```text
AgentOrchestrator
├── DiscussionCoordinator
├── AgentStrategyPlanner
├── TurnCoordinator
├── AttemptMemoryStore
├── CandidateGenerator / CandidateEvaluator / PossibleWorldSampler（M9.3 已实现，独立合理性闸门通过，重新签署前 feature flag 默认关闭）
├── DeadlineController
├── ModelClient
│   ├── OpenAIModelClient
│   └── DeepSeekModelClient
└── AgentTelemetry
```

Agent 是一个逻辑玩家，但按任务使用不同模型：

- 讨论与策略收口：当前发布候选为 GPT-5.4，使用 `low` reasoning effort。
- 实时出牌：当前发布候选为 GPT-5.4 Mini，使用 `low` reasoning effort。
- RetryBrief：当前发布候选为 DeepSeek V4 Flash。
- hint：与出牌合并为同一次 `TurnDecision`，不再单独调用 LLM。
- 上述配置仍是可配置的发布候选，必须通过 R4 批量真实 Provider eval 后才能成为稳定默认。

### 6.1 讨论与策略

讨论模型只接收不含手牌的 `DiscussionView`。Agent 按顺序参与讨论，读取当前关卡、真人发言、其他 Agent 的公开发言、公开实体和同关 `RetryBrief`。

讨论结束时，`AgentStrategyPlanner` 为每个 Agent 独立生成并锁定一份 `SeatStrategy`。共享的是公开讨论、公开实体与公开承诺；每个 Agent 的规则理解、私人计划、信念和行动按座位隔离。无法确认或相互冲突的内容进入 `unresolved`，不得自动提升为硬承诺。策略自动收口，不增加房主审批或编辑步骤。

### 6.2 实时决策

出牌模型接收 `TurnView`：遮蔽后的房间状态、自己的可见手牌、本座位锁定的 `SeatStrategy`、私人 memory 与候选动作。一次响应同时返回：

```ts
interface TurnDecision {
  cardId: string;
  segment: number;
  revealIntent: "yes" | "no";
  appliedStrategyRuleIds: string[];
  relaxedStrategyRuleIds: string[];
}
```

模型请求 deadline 必须小于游戏 deadline。默认 10 秒回合中，模型硬预算为 **7.5 秒**，为 race 延迟、规则兜底、状态写入与广播保留 2.5 秒；更长回合的单次出牌模型预算也封顶 **10 秒**。使用 `AbortController` 真正取消请求，并以本地 abort gate 保证即使 Provider 未及时兑现取消，房间也会在硬截止立即采用安全策略。模型决策耗时与玩家可见的落子节奏分离：AI 通常在回合窗口的 50%–65% 时落子，可见思考时间控制在 **5–10 秒**；10 秒房间的目标落子窗口为 **5–8 秒**。若模型已思考超过目标节奏则结果就绪后立即落子，不追加等待。阶段或回合变化必须同时取消模型请求和节奏等待。

### 6.3 候选与隐藏信息

- `TurnCoordinator` 每回合从同一份安全 `TurnView` 生成一次候选；prompt、top-K 硬边界、fallback 与 telemetry 共用该候选快照。
- 只剪掉从 Agent 可见信息即可严格证明必输的候选。
- `hard_commitment` 在存在可执行候选时参与强制过滤；`strong_preference` / `suggestion` 参与评分；`unresolved` 不参与硬过滤。
- 策略与全部合法动作冲突时，服务端游戏规则优先并记录 `relaxedRuleIds`，不能卡住回合。
- 候选主路径由 `AGENT_CANDIDATE_ENGINE_V1` 控制；`AGENT_HIDDEN_SAMPLING_V1` 控制可能世界采样；开启候选后 `AGENT_MODEL_TOP_K_ONLY` 决定低置信回合是否调用模型从 top-K 选择。2026-07-23 的 `m9.3-reasonable-v3-independent` 对 180 个配对 seed 的完整轨迹独立审计，合理落子、提示合理性、信念物理一致性和协调遵守均通过；候选主路径在本轮复核重新签署前仍默认关闭，隐藏采样默认关闭。
- 高置信 top-1 可跳过 Provider；榜外输出、超时、预算、熔断和 Provider 错误统一使用同一候选 #1，`revealIntent=no`。
- 候选排序必须基于可见信息、讨论策略和本座位私人 `value-belief-v2`；物理可能值与“成功条件兼容值”必须分开，关卡胜利条件不得伪装成牌值事实。
- `value-belief-v2` 每回合从安全 `TurnView` 派生：同色牌池核账、己方合法已知落牌记忆、公开落子和座位策略只做软调权；信念用于共享区段补位评分和保守的 `belief_signal` 提示决策。空兼容域显式标为 `inconsistent`。
- 完全信息求解器只能运行在采样出的可能世界中，不能直接用真实 `GameRoom` 为 Agent 提示答案。
- telemetry 记录 `selectionSource`、`candidateSetHash`、`evaluatorVersion` 与 `hintDecisionSource`，供后续配对 eval 和持久化复现。

## 7. Memory 与 Context

Agent memory 是服务端外部记忆，LLM context 只是每次调用时对相关记忆的临时投影。短期记忆描述生命周期；感知、实体、策略和信念描述记忆内容。服务端权威 `GameRoom` 不复制进 memory，而是按权限实时投影为视图。

```text
AttemptMemory
├── shared
│   ├── observations
│   ├── publicEntities
│   └── retryBriefInput?
└── privateBySeat
    ├── privateObservations
    ├── entityBeliefs
    ├── strategyDraft
    ├── lockedSeatStrategy
    ├── ownActions
    ├── currentBeliefs
    └── pendingCommitments
```

`observations` 是 Agent 合法看到的不可变事件；实体记忆从事件中提取玩家、区段、承诺和规则事实并保留来源；`SeatStrategy` 把讨论结论编译为带强度的可执行规则；私人信念不得回写为共享事实。

当前 attempt memory 与 `GameRoom` 一起保存在内存中。数据库只保存已完成或需要评测的业务记录，以及用于同关恢复的精简 `RetryBrief`；不保存模型完整思维链。详细类型、生命周期和可见性约束见 [Agent 记忆系统设计](agent-memory-system-design.md)。

## 8. 持久化目标

PostgreSQL 目标表：

- `app_progress`：全局通关进度与设置。
- `game_attempts`：关卡、人数、Agent 数、开始/结束时间与结果。
- `seat_strategies`：每座位锁定的结构化策略及版本。
- `level_runs` / `retry_briefs`：同关连续重试与可恢复的公开经验摘要。
- `agent_decisions`：模型、延迟、token、候选、选择和 fallback reason。
- `chat_messages`：仅在需要完整回放时启用。

数据库不可用不得阻塞出牌关键路径。是否允许在数据库故障时继续对局，需要在持久化实施计划中明确；第一版可允许继续实时对局并记录结构化错误。

## 9. 部署与扩展边界

- Web 实例固定为 1；当前 Socket.IO 不需要 Redis Adapter 或 sticky session。
- PostgreSQL 负责持久数据，不负责实时回合协调。
- 若未来引入多房间或多 Web 实例，必须重新设计房间路由、共享实时状态、Socket.IO Adapter 和定时器归属。
- AgentScope 可作为未来离线 `agent-lab` 的候选，用于批量模拟和评测；不进入实时生产链路。

## 10. 横向质量要求

### M9.3 候选、契约与采样（2026-07-22）

- 讨论事实先编译为唯一的 `PublicCoordinationContract`，再按座位投影到独立 `SeatStrategy`；只有真人公开确认且无冲突的可执行规则才能升级为硬约束。
- 可执行 DSL 包括 `segment_assignment`、`avoid_segment`、`value_band`、`color_allocation`、`placement_order`、`reserve_capacity`、`hint_policy`；`custom` 只展示，不进入机器强制。
- 候选 evaluator 版本为 `m9.3-v3-belief`。可能世界采样只接受 `TurnView + seed + budget`，默认 8 世界、12 候选、30ms；采样排序使用由预算换算的固定节点上限，墙钟时间只作遥测，不影响固定 seed 的搜索结果和排序。
- `DerivedTurnState` 从安全视图重算。RetryBrief v2 分离 `deterministicFindings`、`contractOutcomes`、`modelLessons`，模型补充不能覆盖确定性结论。
- 冻结评测覆盖 level-01/04/08、2/3/4 人、每关 60 个配对 seed。旧胜率闸门仅保留为诊断；现行独立完整轨迹合理性闸门通过，报告为 `evals/2026-07-23-m9-3-reasonable-v3-independent-report.json`。真实 Provider 30 次重复验证 turn top-K 30/30 合法、p95 2.748s、零超时/零 fallback。候选与采样在本轮复核重新签署前继续默认关闭，模型选择器不脱离候选主路径单独启用。

- 可见性：任何 Provider 请求都不能包含 Agent 权限外的牌值。
- 实时性：记录 p50/p95/p99、超时率与 fallback 率。
- 可回归：每次人数、Agent 或接管能力扩展都补服务端、Socket 和 E2E 测试。
- 可观测：日志关联 `attemptId`、`seatId`、`phaseVersion`、`turnVersion`、provider、model 和 decisionId。
- 可复现：生产尽量锁定模型 snapshot；模型 alias 变更必须重新跑 eval。
- 隐私：聊天和昵称发送给第三方 Provider 的范围、保留和日志策略需要在部署说明中公开。
