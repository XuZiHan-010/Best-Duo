# Take Time 后端开发计划

> 状态：**maintained module reference**。M0–M8 的历史设计与模块说明保留；当前系统边界以 [architecture.md](architecture.md) 为准，M9 的实际执行以 [m9-agent-implementation-plan.md](../plans/m9-agent-implementation-plan.md) 为准。文中“未来预留”“MVP 锁 2”只代表历史阶段，不得用于覆盖现行架构。

> 配套文档：[设计方案](take-time-web-prototype.md)（状态机 / 数据模型 / Socket 事件 / 服务端校验的权威口径）、[规则总结](../rules.md)、[关卡设计](../levels/README.md)、[前端规划](frontend-ui-plan.md)。
> 本文只管**后端**：把设计方案里已定稿的行为转化成可执行的仓库结构、核心模块、Socket 实现矩阵、测试与部署、里程碑。
> 核心红线：**服务端是唯一权威状态来源**——所有关键校验、胜负判定、计时判负、手牌/暗牌可见性遮蔽都在服务端；前端只发意图、收状态。本计划不改机制，机制以 [rules.md](../rules.md) 与 [设计方案](take-time-web-prototype.md) 为准。

**现行决策**：① npm workspaces 三包（client / server / shared）；② 实时房间与本局 Agent memory 保持单进程内存；③ 当前进度使用 Railway Volume JSON，面试版本目标迁移到 PostgreSQL；④ 后端 TypeScript；⑤ Web 服务保持 Railway 单实例并同源托管前端；⑥ Agent 使用项目内 TypeScript 领域编排与 OpenAI/DeepSeek 双 Provider。

**v1.0 硬化（采纳 codex review）**：写死后端最易出隐性 bug 的边界口径——稳定 `cardId`（§2.1）、zod 运行时 payload 校验（§2.7）、计时器清理 + 版本幂等（§2.5）、`settings:update` 落盘 + schemaVersion + 损坏兜底 + 去重（§2.6）、关卡 1–6↔0–5 归一化（§2.8）、断线/离开/房主离开规则（§3.1）、固定牌库与可解性防假通过（M1）、可见性防泄漏 + 重连/计时器测试（§4）。**优先级最高四项**：cardId、payload 校验、timer 幂等、settings 写盘。

**v1.1 可扩展（N 人 + Agent）**：数据模型与核心逻辑已向玩家数无关、行动者无关演进——① 固定 A–D 四座、实际 2–4 人弹性开局；② 发牌规则表按玩家数分流（2: 每人6张含盲牌；3: 每人4张全可见；4: 每人3张全可见；每局总牌数恒 12）；③ 抢先手后按座位序循环；④ 真人 socket 与 Agent 决策走同一动作层；⑤ M9 将过渡 `PlayerAgent` 升级为带 attempt、团队策略和外部 memory 的领域编排。

---

## 1. 仓库结构（npm workspaces 三包）

```
take_time/
  package.json            # 根：workspaces=[client,server,shared]，统一脚本 + engines.node
  tsconfig.base.json      # 共享 TS 配置，paths 指向 @take-time/shared
  railway.json            # Railway build/start/healthcheck/restart 策略
  .nvmrc                  # 固定 Node 版本，防 Railway 默认版本漂移
  shared/                 # 前后端共享，无运行时依赖
    src/
      events.ts           # 所有 socket 事件名常量 + 收发 payload 类型
      state.ts            # GameRoom / Seat / HandCard / PlacedCard / Phase / Message 类型
      level.ts            # Challenge / Condition 联合类型（与 levels 词汇对齐）
      agent.ts            # PlayerAgent 接口 + AgentRoomView 类型（预留）
      index.ts
  server/                 # Express + Socket.IO（TypeScript）
    src/
      index.ts            # 启动：Express 静态托管 client/dist + Socket.IO + /healthz，监听 PORT/0.0.0.0 + SIGTERM 优雅关闭
      socket/
        registerHandlers.ts   # 绑定客户端事件 → 鉴权 + zod 校验 → 转调动作层 → 广播
        emit.ts               # room:state / player:hand / timer:sync 等出站封装
      game/
        room.ts           # 单例 gameRoom 内存对象 + 创建/重置
        seating.ts        # N 个座位入座/离座/同昵称重连恢复（按 capacity）
        ready.ts          # 准备切换 + 第一个准备者记为 host
        phases.ts         # 状态机推进 waiting→…→result 的转换函数
        dealRules.ts      # 玩家数→发牌规则表（2:6张中4可见端2盲；3:4张全可见；4:3张全可见）
        deal.ts           # 按 dealRules 发牌 + 可见性标记
        turnOrder.ts      # 抢先手 + 之后按座位序循环出牌（N 人通用）
        actions.ts        # 动作层：applyPlacement / applyHintDecision（人/机器人同一入口）
        placement.ts      # 抢先手并发仲裁 + card:place 落子校验（被 actions 调用）
        hint.ts           # pendingHint 窗口、hint:decide、标记额度（被 actions 调用）
        timers.ts         # 权威计时器：讨论/回合/提示三类 deadline + 超时判负 + 幂等
        reveal.ts         # 揭示：统计6段总和 + 跑条件引擎
        visibility.ts     # 下发前遮蔽：按发牌规则遮蔽对己暗牌 / 桌面暗牌
      agent/
        PlayerAgent.ts    # 预留：异步机器人决策接口实现位（MVP 仅类型/桩）
        agentDriver.ts    # 预留：轮到 agent 座位时驱动其经动作层行动（MVP 不实现具体 agent）
      levels/
        loadLevels.ts     # 加载关卡定义 + 1–6↔0–5 归一化 + 条件校验
        conditionEngine.ts# 条件引擎：输入6段牌堆 → { pass, failedConditions }
        data/             # 关卡数据（从 levels/*.md 结构化条件转 TS/JSON）
      persistence/
        progressStore.ts  # 读写 Volume 上 progress.json + flushSync（优雅关闭用）
      validation/
        schemas.ts        # zod：所有入站 payload 的运行时校验（昵称/levelIndex/segment/cardId/settings 白名单）
      config.ts           # PORT、DATA_DIR、SEAT_HOLD_MS、默认设置、（预留）LLM Secrets
    tests/                # Vitest 单测
  client/                 # 前端（见 frontend-ui-plan.md）；本计划只约定它产出 dist/ 供 server 托管
```

**类型单一来源**：`shared` 同时被 client、server import，杜绝 socket payload 双套定义漂移。`Condition` 联合类型直接对应 [levels/README.md](../levels/README.md) 的条件词汇表。

---

## 2. 核心模块设计

### 2.1 单例 GameRoom（内存权威状态，N 座位）
按设计方案 §单房间双人逻辑实现 `gameRoom`，但**座位泛化为 N 个**（不再写死 A/B）：
- `capacity` 表示房间上限并恒为 4；`seats: Seat[]` 固定包含 A–D。实际发牌人数与开始条件按 occupied seats 派生，房主不再选择容量。
- `Seat { id, kind: 'human'|'agent', nick, agentId?, connected }`；`ready` / `hands` / `playedCount` 均**按座位 id 索引**（不再是 `{A,B}`）。`host` = 某座位 id（第一个准备者）。
- 其余字段沿用：phase / settings / progress / currentLevelIndex / currentChallenge / placements / hintMarkers / turn / pendingHint / chat / timers / revealResult / failureReason。
- **聊天消息结构化**：`chat: Message[]`，`Message { id, senderSeatId, kind: 'human'|'agent', text, ts }`。座位归属让前端按座位渲染、让 agent 区分发言者；`kind` 区分真人/agent 消息。`chat` 进入 `room:state` 广播，同时是 §2.10 `AgentRoomView` 的来源字段（讨论聊天对全体玩家可见，喂给 agent 作策略上下文）。`senderSeatId`/`kind`/`ts` 一律由**服务端**赋值，不信任客户端自填发送者。
- 单进程内存单例；进行中对局**不落盘**（重启丢失可接受）。仅 `progress` 落盘，启动时从 JSON 加载。
- **稳定 cardId**：`HandCard` / `PlacedCard` 各带不可变 `id`。`card:place` 提交 `cardId` 而非数组下标——避免重连、出牌后手牌数组变化、客户端重复点击导致的错牌 / stale index。服务端按 id 定位手牌并校验归属。
- 含 `phaseVersion` / `turnVersion` 单调计数器，供计时器幂等使用（见 §2.5）。

### 2.2 状态机（`phases.ts`）
固定流转 `waiting → levelSelect → discussion → placing → reveal → result`。每个转换是显式函数，转换时校验前置 phase；每次状态变更后统一调用出站广播。

### 2.3 条件引擎（`conditionEngine.ts`）— 优先 TDD 的纯函数
纯函数：输入 6 段放置牌列表 + `Condition[]`，派生牌值总和、各段牌数、颜色数量和出牌顺序 → `{ pass, failedConditions[] }`。覆盖 [levels/README.md](../levels/README.md) 全部类型：`all-nonempty / min-cards / max-cards / exact-cards / sum-equals / sum-range / parity / non-decreasing / non-increasing / adjacent-diff / placement-order / segment-colors / min-color-cards / all-distinct / max-sum-each`。空段总和按 0 计（与 [level-02](../levels/level-02.md) 备注一致）。最值得先写、最易单测，作为 M1 起点。**只吃归一化后的 0–5 口径**（见 §2.8）。

> **扩展点**：新增条件类型需同步 README 词汇表、`shared/level.ts` 的 `Condition` 联合、本引擎 `case`、发牌求解器 `solver.ts`、前端 `conditionText.ts`/必要的 `segmentHints.ts` 映射，与 [levels/README.md · 扩展工作流](../levels/README.md) 一致。`max-sum-each { value }`（每段总和 ≤ value）即时钟中心值 `centerCap` 的引擎表示。

### 2.4 可见性遮蔽（`visibility.ts`）— 安全关键
**下发前**按接收者裁剪，绝不把隐藏牌值发给客户端：
- `room:state`（广播公共态）：桌面 `revealed=false` 的牌只给 owner/count，不给 value；用提示标记翻开的牌给 value。
- `player:hand`（私有）：可见性**由发牌规则决定**（§2.9）。2 人：对己暗牌（端 2 张）在**双方都各自累计打出 2 张前**屏蔽 value，达到阈值后分别向各自持有者翻开；3/4 人：手牌**全可见**，无盲牌、无“打满 2 张翻牌”。任何情况下队友手牌永不下发、桌面暗牌 value 永不下发。可见性查询统一走 `dealRules` 纯函数，不写死“端 2 张”。

### 2.5 权威计时器（`timers.ts`）
服务端持有真实 deadline，`timer:sync` 在 `room:state` 广播时同步当前权威 deadline；前端按 deadline 本地渲染剩余时间，服务端不做周期 tick：
- 讨论倒计时（默认 5 分钟）→ 到点自动 `beginPlacement`。
- 回合思考倒计时（默认 5s）→ 抢先手都没出 / 交替期当前玩家超时 → **判负**进 result（`failureReason='timeout'`）。
- 提示 5s 窗口 → 超时按 No，**不判负**，再交手。

判负只由服务端宣布；前端计时归零仅视觉。

**清理与幂等（必须）**：每次 phase / turn 变更都先 `clearTimeout` 旧 timer 再建新 timer；timer 回调闭包捕获建立时的 `phaseVersion` / `turnVersion`，触发时若与当前版本不符则**直接丢弃**（防止 `retry` / `next` / `backToLevelSelect` / `reset` 留下的旧 timeout 误判负）。所有 timer 句柄挂在 `gameRoom.timers` 上，便于统一取消。

### 2.6 持久化（当前 `progressStore.ts`，目标 PostgreSQL repository）
当前 Volume 上单个 `progress.json` = `{ schemaVersion, clearedLevels: number[], settings }`。
- 启动读 + 通关后**原子写**（写临时文件再 rename，防半写损坏）。
- **`settings:update` 成功后也原子写盘**（设置需跨重启保留，不能只在通关时写）。
- `clearedLevels` 写入前**去重 + 升序**；`schemaVersion` 便于将来迁移。
- **损坏 / 缺失 JSON 兜底**：解析失败记一条 warn，回退默认 `{ clearedLevels: [], settings: 默认值 }`，不让服务崩溃。
- `DATA_DIR` 走环境变量，本地默认 `./data`，Railway 指向 Volume 挂载点；**临时文件与目标同在挂载点**（跨设备 rename 会失败）。
- 暴露 `flushSync()` 供 `SIGTERM` 优雅关闭钩子调用（§5.5），确保关停前最后一次写盘落地。

面试版本按 [ADR-0001](adr/0001-runtime-state-and-persistence.md) 迁移到 PostgreSQL：实时 `GameRoom`、timer 和本局 Agent memory 不入数据库；数据库保存进度、已完成 attempt、团队策略和 Agent 决策指标。迁移时先抽象 repository，再提供一次性 JSON 导入，不长期双写两套权威存储。

### 2.7 入站 payload 运行时校验（`validation/schemas.ts`）— 安全关键
`shared` 类型只在编译期约束；Socket 收到的客户端数据运行时仍可能是脏的。用 **zod** 对每个入站事件 payload 做运行时校验，`registerHandlers` 在进入业务逻辑前先 `parse`，失败发 `room:error` 并丢弃：
- 昵称：长度 / 字符白名单；`levelIndex`：整数且在合法关卡范围；`segment`：整数 0–5；`cardId`：属于该玩家当前手牌的字符串 id；`settings`：讨论时间、思考时间、标记数使用枚举白名单，`capacity` 不再属于可更新设置；`decision`：`'yes'|'no'`。
- 这是“服务端权威”红线的一部分——不信任任何客户端输入。

### 2.8 关卡数据归一化（`loadLevels.ts`）
`levels/*.md` 的结构化条件用区段编号 **1–6**，运行时 `placements` 用 **0–5**。在 `loadLevels` 处**统一 normalize 成内部口径（0–5）**，条件引擎内部只吃一种口径。牌库固定为 24 张并由 `deal.ts` 每局抽 12 张，关卡不再携带 `deck`。
- **关卡级属性 → 条件派生**：`centerCap` 为 `number | "inf" | null`；`null`/省略时注入默认 24 的 `max-sum-each`，数字按该值注入，只有 `"inf"` 不注入上限。

### 2.9 玩家数与发牌规则表（`dealRules.ts`）— N 人就绪
每局从固定 24 张牌库抽出 12 张候选牌；按玩家数分流发牌与可见性，**集中在一张规则表**，发牌/可见性/翻牌逻辑只读这张表，不在各处写死 2 人假设：

| 玩家数 | 每人手牌 | 初始可见性 | “打满 2 张翻盲牌” |
| --- | --- | --- | --- |
| 2 | 6 | 中间 4 张可见、两端 2 张盲 | **有** |
| 3 | 4 | 全部可见 | 无（无盲牌） |
| 4 | 3 | 全部可见 | 无（无盲牌） |

`dealRules[count]` 提供：`handSize`、`initialVisibleMask(handSize)`、`revealRemainingAfter`（打满几张后翻盲牌，3/4 人为 `null`）。`deal.ts` 与 `visibility.ts` 均消费它。其余规则（6 区段、12 张放满、提示标记、抢先手、超时判负、揭示校验）**与玩家数无关，完全复用**。

### 2.10 动作层与 Agent 接口（`actions.ts` / `agent/*`）— 行动者无关
**核心抽象**：把“谁来行动”和“行动如何改变状态”解耦。
- `actions.ts` 暴露 `applyPlacement(seatId, cardId, segment)` 与 `applyHintDecision(seatId, decision)`，内含全部校验与状态推进。**人类 socket handler 与未来机器人驱动都调它**，游戏逻辑对行动者是人是机一无所知。socket handler 只做“鉴权 + zod 校验 + 转调动作层”。
- `turnOrder.ts`：第一手抢先手；之后按座位序循环（seat0→…→seatN-1→seat0），直到 12 张放满，自然每人 `handSize` 张。回合归属判断对 N 人通用。
- 现有 `PlayerAgent` 三方法接口是 M9 前的过渡骨架：

  ```ts
  interface PlayerAgent {
    decidePlacement(view: AgentRoomView): Promise<{ cardId: string; segment: number }>;
    decideHint(view: AgentRoomView): Promise<'yes' | 'no'>;
    // 预留：讨论阶段发言（agent 是完整队友，既读人类讨论也主动发言）；返回 null = 本轮不发言
    decideDiscussion(view: AgentRoomView): Promise<{ message: string } | null>;
  }
  ```

  M9 将按 [当前架构 §6](architecture.md#6-agent-架构) 演进：
  - 用不含手牌的 `DiscussionView` 与经过遮蔽的 `TurnView` 替代单一 `AgentRoomView`。
  - 每次重新讨论/发牌创建 `attemptId`，团队策略与私人 memory 仅在当前 attempt 有效。
  - 讨论结束生成全队唯一 `TeamStrategy`。
  - placement 与 hint 合并成一次 `TurnDecision`。
  - 超时使用 `AbortController`，fallback 为候选第一名再到脚本 bot，不使用合法随机作为首选。
  - 候选评分只能使用 Agent 可见信息，不能通过完全信息求解器间接作弊。

---

## 3. Socket 事件实现矩阵

入站（`registerHandlers.ts`，每个先做身份/阶段/合法性校验，非法发 `room:error`）：
`player:join` · `player:leave` · `player:ready` · `settings:update`\* · `game:start`\* · `host:selectLevel`\* · `game:beginPlacement`\* · `chat:send` · `card:place` · `hint:decide` · `game:retry`\* · `game:next`\* · `host:backToLevelSelect`\* · `room:reset`
（\*= 仅 host，服务端二次校验身份）
- `settings:update` 不再包含 `capacity`；房间固定 4 座，实际人数由就位座位决定。
- `chat:send`：服务端落库时**由服务端赋 `senderSeatId`/`kind='human'`/`ts`/`id`**（§2.1 `Message`），不信任客户端自填发送者。
- **M9 已有骨架**：`host:addAgent` / `host:removeAgent`、registry、脚本 Agent 与 handoff 已接入；真实讨论、策略、memory 和 LLM 见新版 M9 计划。Agent 不通过 `chat:send` 入站，其发言和动作由服务端内部入口注入。

出站（`emit.ts`）：`room:state`（遮蔽后广播）· `player:hand`（私有遮蔽）· `room:error` · `timer:sync` · `game:result`。

校验清单完整对齐设计方案 §服务端校验：至少 2 个就位座位且至少 1 名人类 / 阶段允许 / 房主专属 / 区段 0–5 / 抢先手首个有效生效其余拒 / 交替轮次 / 拥有该牌且盲牌允许 / 思考超时 / 提示窗口归属与额度 / 2 人局双方达到阈值后翻盲牌 / 放满 12 张才揭示 / 通关写盘。**每个 handler 先过 §2.7 的 zod 校验**，`card:place` 按 `cardId` 定位与校验归属（不用下标）。

### 3.1 断线 / 离开 / 房主离开规则（先写清口径，再在 M2/M7 落地）
- **座位保留**：连接断开后座位保留 **60s**（可配 `SEAT_HOLD_MS`），同昵称在保留期内重连恢复原座位与身份（含 host）。
- **主动离开**（`player:leave`）：等待/选关/结算等非进行中阶段立即释放座位（不等保留期）；`discussion` / `placing` 阶段主动离开直接判负，进入 `result` 且 `failureReason='player-left'`。
- **房主离开**：保留期内 → 保留 host；超期 / 主动离开 → host 转移给仍在场的另一名玩家；全员不在 → 房间软重置回 `waiting`（**保留 `progress`**）。
- **对局中断线**：计时器**继续按服务端 deadline 跑**（判负以服务端为准，不因前端断线暂停）；若全员断线则暂停计时直到任一方重连或保留期到。
- 这些规则需与设计方案 §登录规则一致；如冲突以设计方案为准并回写。

---

## 4. 测试策略（Vitest）

- **纯单元（不依赖 socket）**：条件引擎全类型用例（边界：空段、相等、范围端点）；发牌可见性标记；抢先手并发仲裁；打满 2 张翻牌；超时判负转换。条件引擎与状态转换走 TDD（先写测试）。
- **集成（in-memory socket）**：用 `socket.io-client` 连本地 server 跑一局闭环——入座 → 准备 → 选关 → 讨论 → 出牌（抢先手 + 交替 + 盲打 + 提示）→ 揭示 → 结算 → 持久化 → 重启读回。
- **可见性防泄漏测试**（安全关键）：分别断言 A / B 收到的 `room:state` 与 `player:hand` **绝不含不该看到的 value**（对己暗牌未翻开前、桌面未用标记的牌、队友手牌）。
- **重连与计时器测试**：断线重连恢复座位 / host；旧 timer 在 phase/turn 变更后**不误触发**（`phaseVersion`/`turnVersion` 幂等）；`pendingHint` 暂停期间**不会被回合 timer 判负**。
- **payload 校验测试**：脏 `levelIndex` / `segment` / `cardId` / 越界 `settings`，以及试图更新已移除的 `capacity` 字段，都被拒并回 `room:error`，不污染状态。
- **发牌规则表测试**（N 就绪）：`dealRules` 对 2/3/4 人分别产出 6/4/3 张、可见性掩码正确、`revealRemainingAfter` 仅 2 人有；即使 MVP 只跑 2 人也先把 3/4 项断言锁住，防回归。
- **行动者无关测试**：直接调 `actions.applyPlacement`（绕过 socket，模拟未来 agent 驱动）与经 socket 的人类落子，对相同状态产生**一致结果**——验证动作层不耦合“人/agent”。
- **`AgentRoomView` 测试**（预留断言，MVP 不跑 agent）：构造 agent 视角的 `AgentRoomView`，断言**含完整讨论 chat**（全可见），但**不含该 agent 视角外的牌值**（对己暗牌 / 桌面未翻牌 / 队友手牌）——chat 全给、牌值仍遮蔽。
- 对齐设计方案 §测试计划逐条断言。

---

## 5. 部署（单 Web 实例，持久化演进到 PostgreSQL）

当前部署是 Railway 单 Web 服务单实例 + Volume；面试版本目标是单 Web Service + PostgreSQL Data Service。Web 实例仍固定为 1，实时房间不迁入数据库。

### 5.1 单实例 / 单进程（约束来源）
- 房间状态、手牌、暗置牌、计时器全在**单进程内存**——**不支持横向扩容**（多实例各持一份房间，状态不一致）。Railway 实例数固定为 1。
- 因为单实例 + Express 同源托管前端，**Socket.IO 无需 sticky session、无需共享适配器（Redis 等）**，WebSocket 直连同源，省去跨域。

### 5.2 构建与启动（Nixpacks / 可选 Dockerfile）
- 根 `package.json` 脚本：`build` = 构建 shared → 构建 client（产出 `client/dist`）→ 构建 server（产出 `server/dist`）；`start` = `node server/dist/index.js`。
- **workspaces 在 Railway 的构建**：根 `npm ci` 安装全部 workspace 依赖；构建顺序 shared 先行（client/server 依赖它）。`engines.node` 固定 Node 版本（如 `>=20`），附 `.nvmrc`，防 Railway 默认版本漂移。
- 默认 Nixpacks 即可（`build`/`start` 显式给出）；如需可重复构建再加 `Dockerfile`。`railway.json` 固化 build/start/healthcheck/restart 策略。

### 5.3 运行时网络
- server `express.static` 托管 `client/dist`，**同端口**挂 Socket.IO，监听 `process.env.PORT`、绑 `0.0.0.0`（Railway 注入 PORT）。
- 暴露 **`GET /healthz`** 轻量健康检查（返回 200 + 进程/房间存活），配到 Railway healthcheck。
- 前后端同源 → CORS 不需放开；Socket.IO 走默认同源即可。

### 5.4 持久化（当前 Volume，目标 PostgreSQL）
- **挂载 Railway Volume**，`DATA_DIR` 指向挂载点存 `progress.json`。容器文件系统重启即失，**只有 Volume 持久**——所有需跨重启的数据（已通关进度 + 设置）只写 Volume，绝不写容器临时盘。
- 原子写（临时文件 + rename）须保证临时文件与目标**同在 Volume 挂载点**（跨设备 rename 会失败）。
- PostgreSQL 落地后，进度、设置、attempt、策略和 Agent 决策改由 repository 写库；完成一次性导入后移除 JSON 双写，避免双权威。

### 5.5 重启 / 重新部署语义（必须设计）
- Railway 重新部署 / 重启 → 进程重建：**进行中的对局丢失可接受**，但 `progress.json` 在 Volume 上保留。
- 所有 socket 断开 → 客户端自动重连到新进程，但内存房间已空 → 按 §3.1 **软重置回 `waiting`，`progress` 从 Volume 重新加载**。
- **优雅关闭**：监听 `SIGTERM`（Railway 关停信号），退出前 `flush` 一次 `progress`（确保最后一次通关/设置已落盘）、关闭 Socket.IO、`server.close()`，给客户端重连提示。`progressStore` 提供 `flushSync()` 供关闭钩子调用。

### 5.6 配置与密钥（`config.ts`，含双 Provider Agent）
- 集中从 env 读取：`PORT`、`DATA_DIR`、思考/讨论/标记默认值、`SEAT_HOLD_MS`（断线保留，默认 60s）。缺省值本地可跑，Railway 用环境变量覆盖。
- M9 分别配置讨论与出牌任务的 provider、base URL、API key、model 和 deadline；OpenAI/DeepSeek key 走 Railway Secrets，不入仓库。请求必须可由 `AbortController` 取消，模型 deadline 小于游戏 deadline；超时进入候选兜底链。
- PostgreSQL 使用 `DATABASE_URL`；数据库不可用时不得阻塞实时出牌关键路径。
- 日志走 stdout（Railway 日志面板），结构化输出关键事件（入座/阶段切换/判负/写盘/关闭）。

---

## 6. 里程碑（后端）

> **MVP（M0–M7）只交付并测试 2 人真人**，但 M0–M6 的数据模型 / 发牌表 / 回合序 / 动作层 / 可见性都按 **N 人 + 行动者无关**写。3/4 人与机器人是 M8–M9，届时**不动核心游戏逻辑**。

1. **M0 脚手架（含 Railway 就绪）**：workspaces 三包 + tsconfig + shared 类型骨架（events/state/level，含 `id` 字段、N 座位 `Seat`/`capacity`、`PlayerAgent` 接口类型）+ server 空启动（Express 静态 + Socket.IO 连通 + `/healthz` + 监听 `PORT`/`0.0.0.0` + `SIGTERM` 优雅关闭桩 + `config.ts` 读 env）+ `engines.node`/`.nvmrc`/`railway.json` + 根 `build`/`start` 脚本。**首次即可部署到 Railway 验证空壳连通**。
2. **M1 条件引擎（TDD）+ 关卡数据**：`conditionEngine.ts` + 全类型单测；`loadLevels` 把关卡条件 normalize 到 0–5 口径。后续已演进为固定 24 张牌库、每局抽 12 张并用求解器校验可解性。
3. **M2 入座 / 准备 / 房主 + payload 校验**：`validation/schemas.ts`（zod）接入所有 handler；`player:join` 入座与房间满拒绝、在线同昵称拒绝、同昵称重连恢复座位/host（按 §3.1）、非 waiting 阶段禁止新昵称补位；`player:leave` 非进行中释放、进行中判负；`player:ready` + 第一个准备者记 host；`room:state` 广播 + `room:error`。
4. **M3 选关 / 讨论 / 持久化读**：`game:start`→levelSelect；`host:selectLevel` 加载关卡进 discussion；讨论计时器 + `chat:send`；`progressStore` 启动加载并在 state 暴露 clearedLevels。
5. **M4 出牌核心**：`dealRules`（2 人项先填，3/4 留好）+ `deal` 发牌 + 可见性标记；`actions.applyPlacement` 动作层 + socket handler 转调；`turnOrder` 抢先手 + 座位序循环（2 人即 A↔B）；回合计时器（幂等）+ 超时判负；打满 2 张翻牌（2 人）；`player:hand` 私有遮蔽走 dealRules。
6. **M5 提示系统**：`pendingHint` 5s 窗口 + `hint:decide` + 全队标记额度 + 暂停语义（决议后才换手）+ 提示翻开牌公共可见。
7. **M6 揭示 / 结算 / 写盘**：放满 12 张自动 reveal；统计 6 段 + 跑条件引擎 → `revealResult`；result 成功写 `clearedLevels`（去重升序）落盘、`game:next` 顺序进关、失败 `game:retry`、`host:backToLevelSelect`。
8. **M7 打磨 + Railway 验收**：`room:reset` 仅非生产环境可用、断线 60s 座位保留 + host 离开转移/软重置（§3.1）、计时器幂等回归、可见性防泄漏与 payload 校验测试、集成测试全闭环；**Railway 端到端验收**——挂 Volume 部署，验证 PORT/healthcheck、WebSocket 实时同步、重启后进行中对局清空但 `progress.json` 保留、`SIGTERM` 关停前成功 flush 写盘。

每个里程碑可与前端对应阶段联调（前端 M1↔后端 M2/3，前端 M3/4↔后端 M4/5 等）。

**扩展状态与后续执行**：

9. **M8 2–4 人弹性开局（基本完成）**：固定 4 座、按实际人数发牌、所有真人 ready 即可开始、3/4 人可见性和多人 UI 已落地；待补多人 Socket/E2E 与 Railway 回归。
10. **M9 有记忆的协作 Agent（进行中）**：严格按 [M9 实施计划](../plans/m9-agent-implementation-plan.md) 分 M9.0–M9.5 实施，不再按旧 Claude/单一 `AgentRoomView` 方案开发。
11. **M10 PostgreSQL 与 Agent 可观测性**：迁移 progress/settings，持久化 attempt、团队策略和决策指标。
12. **M11 Eval 与复盘页**：展示通关率、延迟、fallback、成本、策略和决策轨迹。

---

## 7. 待补全 / 依赖

- 关卡不再携带 deck；固定 24 张牌库每局抽 12 张并经过求解器验证。新增关卡需评估随机牌面的可解率与求解器耗时。
- 钟面区段编号方向（S1→S6）需与 `placements` 索引 0–5 的约定、前端锁定一致。
- 总关卡数 N（如 40）随关卡内容确定；加载器按现有 levels 数据驱动，不写死。
- [take-time-web-prototype.md](take-time-web-prototype.md) 已标记为 V1 历史基线；现行架构统一维护在 [architecture.md](architecture.md)。
- 3/4 人的**思考时间 / 提示标记默认值**沿用现设置（与玩家数无关）；如未来想按人数调默认值，再在 dealRules/settings 扩展。

---

## 8. 验证方式（端到端）

- `npm run dev`（server `tsx watch` + client vite）本地起服务。
- 用 2/3/4 个浏览器与 Agent 组合验证固定 4 座、弹性开局、房主、讨论、按人数发牌、抢先手 + 座位序循环、2 人盲牌、提示、揭示和结算；第 5 人才应收到房间已满。
- 当前持久化：通关数关后重启 server，确认 `progress.json` 中 clearedLevels 仍在；PostgreSQL 里程碑完成后改为 migration 与 repository 集成测试。
- `npm test` 跑 Vitest：条件引擎全类型 + 可见性防泄漏 + 重连/计时器幂等 + 发牌规则表(2/3/4) + 行动者无关 + 一局集成闭环绿。
- **Railway 部署验证**：挂 Volume 部署后，两设备访问同一 URL 实时联调；`/healthz` 通过；触发 redeploy/重启确认进行中对局清空、`progress.json` 保留；观察 `SIGTERM` 关停日志确认 flush 写盘成功。
