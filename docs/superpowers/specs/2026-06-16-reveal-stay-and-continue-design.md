# 揭示页停留 + 手动继续 — 设计方案

日期：2026-06-16

## 背景

当前 `reveal` 阶段（钟盘展开所有牌 + 逐条条件校验）只停留 `revealHoldMs`（3 秒，[server/src/config.ts:24](../../../server/src/config.ts#L24)）就自动跳转到 `result` 阶段。`result` 阶段只展示结论文字（通关/失败原因）和未满足条件的简要列表，**不显示钟盘**，玩家来不及看清完整牌面和逐区段校验过程就被推进到选择页（重试/下一关/返回选关）。

## 目标

让玩家在揭示阶段看清「所有牌如何摆放 + 每个区段的条件校验结果」这一完整过程，看完之后由房主手动点击继续，再进入结算选择页。

## 方案

### 服务端改动

1. **取消揭示阶段的自动跳转计时器**
   - [server/src/socket/registerHandlers.ts](../../../server/src/socket/registerHandlers.ts) 的 `afterRevealIfNeeded` 中，删除 `startRevealTimer(ctx.room, config.revealHoldMs, ...)` 调用。`revealAndScore(ctx.room)` 执行后即停留在 `reveal` 阶段，不再自动调用 `enterResultAfterReveal`。
   - [server/src/config.ts](../../../server/src/config.ts) 中的 `revealHoldMs` 字段与其引用一并删除（不再需要）。
   - [server/src/game/timers.ts](../../../server/src/game/timers.ts) 中 `startRevealTimer` 若无其他调用方，一并删除；若被测试直接引用，先确认后处理。

2. **新增「继续到结算」事件**
   - [shared/src/events.ts](../../../shared/src/events.ts) 的 `ClientEvents` 新增：
     ```ts
     GameContinueToResult: "game:continueToResult"
     ```
   - [server/src/socket/registerHandlers.ts](../../../server/src/socket/registerHandlers.ts) 新增对应 handler：
     - 仅房主可触发（`isHost(room, requireSeatId(socket))`，否则报错「只有房主可以继续」）。
     - 仅 `room.phase === "reveal"` 时有效（否则报错「当前阶段无法继续」）。
     - 调用既有的 `enterResultAfterReveal(room)`，然后 `emitStateToAll(io, room)`。

3. **保留断线兜底逻辑**
   - `endGameIfAllDisconnected` 中 `room.phase === "reveal"` 时调用 `enterResultAfterReveal(room)` 的逻辑保持不变，确保全员掉线时不会卡死在 `reveal` 阶段。

4. **超时 / 对手离开路径不变**
   - `failByTimeout` / `failByPlayerLeft` 仍直接进入 `result`（`revealResult` 为 `null`），不经过 `reveal` 阶段，因为没有牌面可展示。

### 客户端改动

1. **[client/src/views/Reveal.tsx](../../../client/src/views/Reveal.tsx)**
   - 保留现有内容：`ClockBoard`（`revealMode` 展开所有牌）、各区段总和、`ConditionList` 逐条校验结果。
   - 新增顶部结论横幅：复用 `revealResult.pass` 判断，通过显示「✦ 通关！」，失败显示「✕ 挑战失败 · 条件未满足」（样式可参考 [Result.tsx](../../../client/src/views/Result.tsx) 的 `result__header`）。
   - 新增「继续」操作区：
     - 房主：显示「继续 →」按钮（连接异常时 disabled，参考 `Result.tsx` 的 `isOffline` 处理），点击调用 `adapter.continueToResult()`。
     - 非房主：显示「等待房主继续…」提示文案。

2. **[client/src/socket/adapter.ts](../../../client/src/socket/adapter.ts)**
   - 新增方法：
     ```ts
     continueToResult() {
       socket.emit(ClientEvents.GameContinueToResult);
     }
     ```

3. **[client/src/views/Result.tsx](../../../client/src/views/Result.tsx)**
   - 不变。继续承担「选择」职责：重试本关 / 进入下一关 / 返回选关。

### 测试改动

- [server/tests/socketFlow.test.ts](../../../server/tests/socketFlow.test.ts)：
  - 原先断言「放满 12 张牌后，等待 `revealHoldMs` 自动进入 `result`」的用例，改为断言「放满后停在 `reveal`，且 `revealResult` 已计算」。
  - 新增用例：房主触发 `game:continueToResult` 后进入 `result`；非房主触发应报错且阶段不变。
- [server/tests/timers.test.ts](../../../server/tests/timers.test.ts)：
  - 删除/调整依赖 `revealHoldMs` 自动跳转的用例。
  - 保留全员断线时 `reveal → result` 兜底的用例。

## 不在本次范围内

- 不改变失败原因文案、`ConditionList` 展示样式。
- 不改变 `timeout` / `player-left` 两种无牌面可看场景的流程。
- 不引入「双方都需确认」机制——继续仍是房主单方操作，与现有重试/下一关/返回选关的房主权限模型一致。
