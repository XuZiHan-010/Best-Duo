# 关卡设计索引

本文件夹存放每一关的设计，一关一个 md 文件（`level-01.md`、`level-02.md`……）。关卡按难度依次递进：先熟悉机制，再逐步引入数值、跨区段关系、颜色和牌数限制。

## 约定

- 每关固定 6 个区段。
- 区段编号 1-6 为人类口径；实现内部使用 0-5。
- 牌库为全局固定 24 张：白色 1-12 + 黑色 1-12。每局随机抽 12 张发牌，每人 6 张。
- 发牌前会通过 `server/src/game/solver.ts` 做可解性校验；无解则重抽。
- 所有 12 张牌必须放完才能揭示；每个区段至少有 1 张牌是永久通用规则。
- 永久通用规则由加载器自动叠加：区段总和从 1 到 6 非递减、每段至少 1 张、每段总和不超过中心值。
- `centerCap`: `number | "inf" | null`。`null` 或省略表示默认 24；`"inf"` 表示无上限。

## 条件类型词汇

| type | 含义 |
| --- | --- |
| `all-nonempty` | 所有区段至少 1 张牌 |
| `min-cards { segment, count }` | 某区段至少 count 张 |
| `max-cards { segment, count }` | 某区段至多 count 张 |
| `exact-cards { segment, count }` | 某区段恰好 count 张 |
| `sum-equals { segment, value }` | 某区段总和等于 value |
| `sum-range { segment, min, max }` | 某区段总和落在 [min, max] |
| `parity { segment, parity }` | 某区段总和为奇数或偶数 |
| `closest-to-value { segment, value }` | 某区段总和必须是唯一最接近 value |
| `non-decreasing { segments }` | 列出的区段总和依次非递减 |
| `non-increasing { segments }` | 列出的区段总和依次非递增 |
| `adjacent-diff { a, b, maxDiff }` | 两个区段总和差不超过 maxDiff |
| `placement-order { order, segment }` | 第 order 张打出的牌必须落在 segment |
| `segment-colors { segment, black, white }` | 某区段恰好包含 black 张黑牌和 white 张白牌 |
| `min-color-cards { segment, color, count }` | 某区段至少包含 count 张指定颜色的牌 |
| `max-color-cards { segment, color, count }` | 某区段至多包含 count 张指定颜色的牌 |
| `forbidden-values { segment, values }` | 某区段不能包含 values 中列出的数值 |
| `all-distinct { segment }` | 某区段内各牌数值互不相同 |
| `has-duplicate-value { segment }` | 某区段内至少有两张牌数值相同 |
| `max-sum-each { value }` | 每个区段总和不超过 value，由 `centerCap` 自动派生 |

## 扩展工作流

新增条件类型时，同步更新：

1. 本 README 的词汇表。
2. `shared/src/level.ts` 的 `Condition` 联合类型。
3. `server/src/levels/conditionEngine.ts`。
4. `server/src/game/solver.ts`。
5. `client/src/lib/conditionText.ts`，必要时同步 `client/src/lib/segmentHints.ts`。

只新增或修改某关的已有条件时，通常只需要改对应 `level-XX.md` 和 `server/src/levels/data.ts`。

## 关卡列表

| 关 | 难度 | 一句话条件 | 状态 |
| --- | --- | --- | --- |
| [第 1 关](level-01.md) | ★ | 区 1 恰好 1 张白牌 + 区 6 恰好 3 张牌，中心值无上限 | 已设计 |
| [第 2 关](level-02.md) | ★ | 区 3 总和 8-12 + 区 4 恰好 3 张牌，中心值无上限 | 已设计 |
| [第 3 关](level-03.md) | ★ | 第 1 张落区 3、第 2 张落区 2 + 区 6 总和 20-30，中心值无上限 | 已设计 |
| [第 4 关](level-04.md) | ★ | 区 1 唯一最接近 6 + 区 4 恰好一黑一白，中心值 24 | 已设计 |
| [第 5 关](level-05.md) | ★★ | 区 1 唯一最接近 6 + 区 2 只能白且至少 2 张 + 区 4 至少 1 黑 1 白 + 区 6 恰好 2 张 | 已设计 |
| [第 6 关](level-06.md) | ★★ | 区 1、3、5 不能放数值 1/2/3，沿用递增和 24 点上限 | 已设计 |
| [第 7 关](level-07.md) | ★★ | 区 3、4 不能放数值 7/8/9，沿用递增和 24 点上限 | 已设计 |
| [第 8 关](level-08.md) | ★★ | 区 3 恰好一黑一白 + 区 5 奇数 + 区 6 总和 22-24 | 已设计 |
| [第 9 关](level-09.md) | ★★ | 区 2 总和 8-12 + 区 4/5 总和差 ≤ 3 + 区 6 至少 2 张白牌 | 已设计 |
| [第 10 关](level-10.md) | ★★ | 区 1 总和 6 + 区 6 恰好 3 张、数值不同、2 黑 1 白 | 已设计 |
| [第 11 关](level-11.md) | ★★ | 区 2 总和 10 + 区 3 偶数 + 区 4 一黑一白 + 区 5/6 总和差 ≤ 4 | 已设计 |
| [第 12 关](level-12.md) | ★★ | 区 3 偶数 + 区 5 总和 16-20 + 区 6 至少一对同值 | 已设计 |
| [第 13 关](level-13.md) | ★★ | 区 2 总和 9 + 区 4 恰好 2 张 + 区 6 恰好 3 张且至少一黑一白 | 已设计 |
| …… | | 后续关卡待补充 | 待补 |

> 总关卡数随关卡内容确定。
