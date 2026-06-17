# 关卡设计索引

本文件夹存放每一关的设计：**一关一个 md 文件**（`level-01.md`、`level-02.md`…）。关卡按**难度依次递进**：先用最简单的关熟悉机制，再逐步引入数值、跨区段关系和牌数限制等约束。后续关卡会持续补充。

> 关卡的数据结构见 [设计方案 · 关卡与挑战模型](../plans/take-time-web-prototype.md)。运行时哪些关已通关由服务端 `progress.clearedLevels` 记录并持久化；本文件夹只描述关卡“设计内容”。

## 约定

- 每关固定 **6 个区段**。
- **区段编号 1–6**（人类口径）；实现内部对应 `placements` 索引 0–5，即区段 `k` = `placements[k-1]`。
- **牌库为全局固定的 24 张**：白色 1–12 + 黑色 1–12（数值 + 颜色两个维度）。每局**随机抽 12 张**发牌，每人 6 张（见 [rules.md](../rules.md)、`server/src/game/deal.ts`）；关卡不再各自携带 `deck`。
- **发牌前做可解性校验**：抽到的 12 张牌经 `server/src/game/solver.ts` 验证至少存在一种满足本关条件的放置方案后才发出；无解则重抽。可用 `npm run assess:levels` 评估各关的随机可解率。
- 所有 12 张牌必须放完才能揭示；每个区段至少有 1 张牌是永久通用规则。
- **永久通用规则**：每关都会自动叠加「区段总和从 1 到 6 非递减」+「每段至少 1 张」+「每段总和不超过中心值」。
- **时钟中心值 `centerCap`**：关卡级字段，`number | "inf" | null`。`null` 或省略 = **默认 24**；`"inf"` = **∞（每区段无上限）**；数字（如 `20`）= **每个区段总和 ≤ 该值**。前端显示在钟面中心；加载器按该字段自动派生 `max-sum-each`，`"inf"` 时不派生上限条件。

## 条件类型词汇（供条件引擎）

| type | 含义 |
| --- | --- |
| `all-nonempty` | 所有区段至少 1 张牌（永久通用规则） |
| `min-cards { segment, count }` | 某区段至少 count 张 |
| `max-cards { segment, count }` | 某区段至多 count 张 |
| `exact-cards { segment, count }` | 某区段恰好 count 张 |
| `sum-equals { segment, value }` | 某区段总和等于 value |
| `sum-range { segment, min, max }` | 某区段总和落在 [min, max] |
| `parity { segment, parity: 'odd'|'even' }` | 某区段总和的奇偶 |
| `non-decreasing { segments: [...] }` | 列出的区段总和依次非递减（≤）；全 6 段版本是永久通用规则 |
| `non-increasing { segments: [...] }` | 列出的区段总和依次非递增（≥） |
| `adjacent-diff { a, b, maxDiff }` | 相邻两区段总和差值限制 |
| `placement-order { order, segment }` | 第 `order` 张打出的牌（1 起）必须落在 `segment`（按出牌时间判定） |
| `segment-colors { segment, black, white }` | 某区段恰好包含 `black` 张黑牌 + `white` 张白牌 |
| `all-distinct { segment }` | 某区段内各牌数值互不相同（不限张数） |
| `max-sum-each { value }` | **每个**区段总和 ≤ value（时钟中心值 `centerCap` 的引擎表示；`centerCap` 不是 `"inf"` 时由加载器自动派生，一般无需手写） |

> 词汇可按需扩展；新增类型时同步更新本表和条件引擎。

## 如何快速新增 / 修改关卡规则（扩展工作流）

关卡仍在陆续设计，规则会持续更新。为保证「改规则不需大改」，每条规则只走**一条固定链路**，新增一个条件类型只需碰 4 处、各加一小段：

1. **本 README 词汇表**：加一行 `type` 与含义（人类口径）。
2. **`shared/src/level.ts`**：把新 `type` 加进 `Condition` 联合类型（前后端共用，单一来源）。
3. **`server` 条件引擎 `conditionEngine.ts`**：加一个 `case`，输入 6 段总和/张数 → `{ pass, message }`。若条件依赖**牌面颜色或出牌顺序**（如 `segment-colors`、`placement-order`），改用传入的 `placements`（含 `color`、`placedAt`）而非仅总和。
4. **`client` `lib/conditionText.ts`**：加一条「条件 → 中文」映射，供条件清单/揭示展示。（前端尚为占位页，该文件待前端开发时建立；目前揭示展示直接用引擎产出的 `message`。）

> 只**改某关的数值/条件**（不引入新 type）时，**只改该关的 `level-XX.md`**（结构化 JSON）即可，前后端代码无需改动——加载器按数据驱动。
> 涉及**关卡级属性**（如 `centerCap`）时，额外在加载器 `loadLevels.ts` 做一次「属性 → 条件」派生 + 前端钟面渲染该属性；`centerCap` 即按此模式实现，是该工作流的样板。

## 关卡列表

| 关 | 难度 | 一句话条件 | 状态 |
| --- | --- | --- | --- |
| [第 1 关](level-01.md) | ★ | 教学关：只使用三条永久通用规则，中心值为 ∞ | 已设计 |
| [第 2 关](level-02.md) | ★ | 区2 总和 12–16 点 + 区6 恰好 3 张牌（中心值 ∞） | 已设计 |
| [第 3 关](level-03.md) | ★ | 第1张落区3、第2张落区2 + 区4 恰好一黑一白（中心值 ∞） | 已设计 |
| [第 4 关](level-04.md) | ★ | 区2 总和恰好 8 + 区6 内各牌数值互不相同（不限张数） | 已设计 |
| … | | 后续关卡待补充 | 待补 |

> 总关卡数（如 40 关）随关卡内容确定。
