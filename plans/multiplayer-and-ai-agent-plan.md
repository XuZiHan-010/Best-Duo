# Take Time：2-4 人弹性开局 + AI Agent 开发方案

> 状态：**M8 completed / M9 section superseded**。本文的 M8 弹性开局部分保留为实施记录；M9 中 Claude、单一 `AgentRoomView`、独立 hint 调用和 `Promise.race` 方案已经废弃。M9 只按 [m9-agent-implementation-plan.md](m9-agent-implementation-plan.md) 执行，当前架构见 [docs/architecture.md](../docs/architecture.md)。

## 背景（为什么做这件事）

当前项目是「单房间双人」原型，后端 MVP（M0–M7）已完成，但 `capacity` 在 5 处被硬编码为 `2`，前端也硬编码了「1 个队友 / 每人 6 张」的二元假设。

目标：把游戏扩展为 **2-4 人**，并支持加入 **最多 3 个 AI agent**，规则为：

- 房间固定最多 **4 个座位**；房主可在 **2-4 名玩家（真人 + agent）就位**后随时开始（**弹性开局**，无需坐满）。
- **禁止单人真人独自开局**：只有 1 名真人时，必须再加入 1 名真人或至少 1 个 agent。
- AI Agent 使用 OpenAI + DeepSeek 双 Provider 的任务路由实现讨论、策略编译和实时出牌；最多 3 个。

好消息：项目架构已为此预埋——`SeatId` 含 `A-D`、`SeatKind: human|agent`、`dealRules[2|3|4]`、`PlayerAgent`/`AgentRoomView` 接口、`turnOrder` 已按座位序循环、求解器接受 `seatIds[]`、发牌按 `seats.filter(nick)` 动态进行。**核心游戏逻辑无需重写**，主要是解锁硬编码 + 调整开局条件 + 填实 agent 桩代码 + 前端 N 人化。

**分两阶段交付**（每阶段独立可验收）：
- **阶段一（M8）**：2-4 人真人弹性开局，完整可玩可测。
- **阶段二（M9）**：接入 LLM agent + 房主加/撤 agent UI。

对应 `docs/product-roadmap-prd.md` 的 V2/V3，但开局条件改为「弹性开局」而非文档原定的「房主预选容量坐满」。

---

## 当前硬编码盘点（需解除）

| # | 文件:行 | 内容 |
| --- | --- | --- |
| 1 | `server/src/config.ts:14` | `defaultSettings.capacity: 2` |
| 2 | `server/src/game/room.ts:32` | `capacity: 2 as const` |
| 3 | `server/src/socket/registerHandlers.ts:353` | `capacity: 2 as const`（settings:update） |
| 4 | `server/src/persistence/progressStore.ts:30` | `normalizeSettings` 强制 `capacity: 2` |
| 5 | `server/src/validation/schemas.ts:24` | `capacity: z.literal(2).optional()` |
| 6 | `client/src/store/selectors.ts:46-59` | `opponentSeatSelector`（单队友）+ `myPlayedCountSelector` 硬编码起手 6 张 |
| 7 | `client/src/components/SettingsPanel.tsx:76-87` | 人数选择 disabled 锁 2 |
| 8 | `client/src/views/Placing.tsx:197-220` | 右栏只渲染 1 个队友 |

---

## 设计决策：弹性开局模型

放弃「房主预选 capacity 后坐满」的旧设计，改为：

- **座位固定 4 个**：`createSeats(4)`，`room.capacity` 恒为 `4`（代表房间上限，不再是必须坐满数）。
- **真人通过空座加入**（`findEmptySeat`），最多 4 人；第 5 人「房间已满」。
- **开局条件**（替换 `allSeatsOccupied(room)`）：设 `occupied = seats.filter(nick)`，需满足
  - `occupied.length` ∈ [2, 4]
  - 至少 1 名真人（`kind === "human"`）
  - 所有真人座位均已准备（agent 座位视为已就绪，不参与 ready）
- **发牌人数**：以 **开局时实际就位数** `occupied.length`（2/3/4）查 `dealRules`，**不再用 `room.capacity`**。`dealRules` 已覆盖 2/3/4：6/4/3 张、3/4 人全可见无盲牌。
- 因 4 人以内总牌数恒 12（6+6 / 4+4+4 / 3+3+3 均整除），无需改发牌/求解器核心。

---

## 阶段一（M8）：2-4 人真人弹性开局

### 后端

1. **解除 capacity 硬编码**
   - `room.ts:6 createSeats`：调用处统一传 `4`；`createGameRoom`（room.ts:28-32）设 `capacity: 4`。
   - `config.ts:14`、`progressStore.ts:30`：`capacity` 改为 `4`（持久化里 capacity 已无实际选择意义，固定 4 即可；保留字段以兼容 schema）。
   - `schemas.ts:24`：`settingsUpdateSchema` 移除 `capacity`（房主不再选容量）；`registerHandlers.ts:353` 删除 `capacity: 2 as const` 覆盖。
   - `shared/src/state.ts`：`RoomSettings.capacity` / `GameRoom.capacity` 类型保留 `2|3|4`→可放宽为 `4`，或保留联合类型仅取 4（最小改动取后者）。

2. **弹性开局校验**（`server/src/game/room.ts`）
   - 新增 `occupiedSeats(room)`、`humanSeats(room)`、`canStartGame(room)`（实现上述 [2,4] + ≥1 人 + 真人全 ready）。
   - 调整 `allReady`（room.ts:108）/ `allConnectedPlayersReady`（refreshHostStartTimer 用，registerHandlers.ts:155）为「真人座位就绪」语义，agent 座位跳过。
   - `registerHandlers.ts:367` 的 `GameStart` 校验：`if (!canStartGame(room)) throw new Error("至少需要 2 名玩家且所有真人已准备")`。

3. **发牌按实际人数**（`server/src/game/deal.ts:30`）
   - `const rule = dealRules[room.capacity]` → `dealRules[seated.length]`（`seated` 已是 `seats.filter(nick)`）。
   - `canSolveDeal(..., seated.map(s => s.id))` 已正确传 seatIds，无需改。

4. **起手张数下发给前端**：在 `shared` 新增 `handSizeForPlayerCount(n: 2|3|4): number`，`server/src/game/dealRules.ts` 的 `handSize` 改为引用它；前端同样引用（避免前端再硬编码 6）。`room.playedCount` 已逐座位记录，`publicRoomState` 如未含可补充每座位 `playedCount`，供前端推算各队友剩余手牌。

### 前端

5. `client/src/store/selectors.ts`
   - 用 `teammateSeatsSelector`（返回**所有**其他已就位座位数组）替换单数 `opponentSeatSelector`/`teammateSeatSelector`。
   - `myPlayedCountSelector`：起手张数改为 `handSizeForPlayerCount(occupiedCount) - myHand.length`。
   - `canStartSelector`：与后端 `canStartGame` 同语义（occupied∈[2,4] + ≥1 真人 + 真人全 ready）。

6. `client/src/views/Placing.tsx:197-220`：右栏「队友」区改为 `teammates.map(...)` 渲染 1-3 个队友（头像/昵称/剩余手牌/状态）。回合提示「等待 X 出牌」按当前 `turn` 座位取名。

7. `client/src/components/SettingsPanel.tsx:76-87`：移除人数选择 Pill（弹性开局无需选），或改为只读说明「2-4 人，房主可随时开始」。

8. `client/src/views/Lobby.tsx`：座位区已 `seats.map`，确认 4 个座位（含空座）正确渲染；开始按钮启用条件用新 `canStartSelector`。

### 测试（阶段一）

- 服务端单测：`canStartGame` 各组合、`dealHands` 在 3/4 人下张数与全可见、可解性重抽。
- Socket 流程测试：3 人、4 人完整跑通（讨论→12 张出牌→提示→揭示→结算）。
- E2E：更新 `client/e2e/lobby-sync-and-capacity.spec.ts`——原「第 3 人被拒」改为「第 5 人被拒」，新增 3 人/2 人弹性开局用例。

---

## 阶段二（M9）：LLM Agent（历史草案，已被替代）

> 以下内容仅用于保留设计演进，不得直接实施。现行接口、memory、deadline、候选评估和模型配置见 [新版 M9 计划](m9-agent-implementation-plan.md)。

已完成的 M9 骨架：房主加/撤 Agent 事件、registry、脚本 Agent、出牌/hint handoff，以及 Lobby/Placing/Chat 的 Agent UI。

尚未完成且已转入新版计划：`attemptId`、`DiscussionView`/`TurnView`、团队策略、外部 memory、讨论调度、OpenAI/DeepSeek adapter、placement+hint 合并、可取消 deadline、候选评估、Agent 抢先手、telemetry 和 PostgreSQL 准备。

---

## 关键复用点（勿重造）

- 回合循环：`server/src/game/turnOrder.ts:nextSeatAfter`（已按 occupied 座位序循环，N 人通用）。
- 动作层：`server/src/game/actions.ts:applyPlacement` / `applyHintDecision`（对人/机无感知，agent 复用同入口）。
- 发牌规则表：`server/src/game/dealRules.ts:dealRules[2|3|4]`（已含 3/4 人规则）。
- 求解器：`server/src/game/solver.ts:canSolveDeal(challenge, cards, seatIds)`（接受任意 seatIds）。
- 遮蔽视图：现有 `buildAgentRoomView` 是过渡实现；M9.0 将拆成不含手牌的 `DiscussionView` 和按座位遮蔽的 `TurnView`。
- 条件中文描述：`client/src/lib/conditionText.ts`（agent prompt 可借用同口径）。

## 验证（端到端）

1. **阶段一**：`npm test`（server 单测 + socket 流程）；`npm run -w client e2e`（Playwright 3/4 人）；本地 `npm run dev` 起服务，开 2-4 个浏览器标签登录同房，验证弹性开局、单真人无法开局、3/4 人全可见无盲牌、各队友面板正确、完整通关与进度持久化。
2. **阶段二**：验证 1 真人+Agent、2+1、2+2、3+1；模拟两个 Provider 的断网、超时、空响应和非法 JSON；确认 attempt memory 隔离、团队策略一致、请求可取消、候选不读取真实隐藏牌且房间不卡死。
