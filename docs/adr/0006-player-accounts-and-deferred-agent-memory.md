# ADR-0006：玩家账号体系与 Agent 长期记忆的推迟决议

- 状态：Accepted
- 日期：2026-07-17
- 实施计划：[玩家账号体系（Phase A）](../../plans/2026-07-17-player-accounts-and-profile-memory-plan.md)
- 相关评审：[账号与长期记忆计划评审](../../plans/2026-07-17-player-accounts-profile-memory-plan-review.md)

## 背景

ADR-0005 确立了"昵称不作为身份凭证、座位所有权由会话凭证证明"，但会话存于 `sessionStorage` 且进程重启即失效：玩家换浏览器、清缓存或隔天回来就变成"新人"，跨会话进度与未来的 Agent 记忆都无从归属。原实施计划试图一次交付"玩家账号 + Agent 长期画像"，评审发现其画像部分与现行架构冲突（`docs/architecture.md` 与记忆设计均把跨会话画像排除在 M9/M10 外）、依赖多处已过时的代码假设，且"一份共享画像注入所有 Agent"不符合"AI 像真人牌搭子一样形成自己的记忆"的产品共识。本 ADR 拆分两件事：账号先行落地，Agent 长期记忆推迟并预先固定架构约束。

## 决策一：昵称 + 个人密码隐式注册，账号密码成为与会话凭证并列的持久凭证

- 无会话凭证的 `player:join` 必须先通过房间密码校验，失败一律 `INVALID_ROOM_PASSWORD` 且**不触达账号层**（不注册、不校验个人密码、不计账号限流）——房间密码是注册与登录的前置门槛，也防止探测昵称是否已注册。
- 通过门槛后：昵称未注册 → 以提交的昵称/个人密码/头像创建账号（隐式注册），返回持久 `playerId`；昵称已注册 → 校验个人密码，不符返回 `ACCOUNT_PASSWORD_MISMATCH`，相符则沿用账号存档的昵称与头像（本次提交的头像被忽略）。昵称与头像自注册起不可修改；数据模型保留"注册昵称 = 登录键 = 显示昵称"的边界说明，未来如需 rename 只放开显示昵称。
- **正确账号密码可接管在线同昵称座位**：这是对 ADR-0005"无有效会话一律 `NICK_IN_USE`"的有意修订——正确密码即证明本人，解决 sessionStorage 丢失后的自锁。接管完全复用 ADR-0005 顺序（先验证、附着并轮换会话成功，最后断开旧 socket）。座位接管优先级：有效会话凭证 > 正确账号密码 > 拒绝。同昵称为 Agent 座位时维持 `NICK_IN_USE`。
- 会话体系不变：登录成功后 `PlayerSessionStore` 以账号的持久 `playerId` 签发 `reconnectToken`，轮换、宽限期、撤销语义全部沿用 ADR-0005；带有效会话的重连不要求个人密码与房间密码。
- 密码学与可用性约束：口令只存 scrypt 摘要（**异步** `crypto.scrypt`，不阻塞与游戏定时器同进程的事件循环），KDF 参数（N/r/p/keylen）随账户记录版本化存储以便将来升级；同昵称 60 秒窗口 5 次失败触发 `ACCOUNT_RATE_LIMITED`。
- **账户库 fail-closed**：`accounts.json` 存在但损坏时进入降级态——拒绝新注册与密码登录（`ACCOUNT_STORE_UNAVAILABLE`），绝不覆盖损坏文件，持有效会话的玩家不受影响。回退空仓库被否决：那等于允许旧昵称被新密码"重新注册"，是身份接管漏洞。

### 被否决的替代方案

- **开放注册页 / 邀请码**：私用单房间场景流程过重，隐式注册配合房间密码门槛已足够。
- **保持 NICK_IN_USE、密码只用于离线重登**：无法解决换浏览器/清缓存后座位被"幽灵占用"的最常见客诉路径。
- **账户库损坏回退空仓库**：见上，fail-closed 是安全要求。

## 决策二：Agent 长期记忆推迟至 M9.5 之后，按三层架构实施

原计划的"`profiles.json` 共享画像注入所有 Agent"**不再采纳**。Agent 长期记忆推迟到 M9.3（候选评估）、M9.4（handoff 验收）、M9.5（repository 边界）落地后另立计划，届时遵循以下已定架构约束：

- **三层拆分**：`PlayerBehaviorFacts`（服务端确定性统计，按 `playerId`，可供系统与多个 Agent 引用）／`AgentIdentity`（稳定 AI 身份）／`AgentRelationshipMemory`（某个 AI 对某个玩家的私有关系记忆，键为 `agentProfileId + playerId`，不自动与其他 AI 共享）。
- **稳定 AI 身份是前置条件**：现行 `HostAddAgent` 每次 `randomUUID()` 生成座位级临时 `agentId`，移除再添加即"另一个 AI"。实施关系记忆前必须引入持久 `agentProfileId`，座位级 `agentId` 关联到它。**开放项**：persona roster 形态（单一固定 persona 还是多 persona 名册）届时再定。
- **只用公开且带作者标识的证据**：关系记忆仅由当时公开可见的 observation 生成，证据必须携带 `senderSeatId`/`senderPlayerId` 等来源标识，防止把队友的话错误归因；隐藏手牌信息、Agent 私有思维链不得进入。
- **结构化 delta 更新 + revision 串行队列**：模型只输出增量建议，服务端按 `(agentProfileId, playerId)` 串行、以 `attemptId` 幂等、以 revision compare-and-swap 提交，旧响应不能覆盖新记忆；每局结算由独立于 AgentRuntime 的结算入口（`GameResultFinalizer` 方向）产生幂等记录，纯真人对局不依赖 Agent 链路。
- **验收以 memory on/off 对照评测为准**，而不是"模型说它记得"。

### 被否决的替代方案

- **共享玩家画像注入所有 Agent**（原计划方案）：更接近"系统给所有 AI 一份玩家标签"，与"每个 AI 像真人一样拥有自己的记忆"的产品共识不符。
- **立即实施三层关系记忆**：M9.5 repository 边界未定，先做会造成 JSON → PostgreSQL 与 context schema 的重复返工；且 Agent 本体的稳定性与可评测性优先级更高。

## 后果

- `accounts.json` 进入 Railway Volume 备份面；M10 PostgreSQL 迁移需带上账户表。运维清理方式为直接删除 Volume 上的文件（无产品化删除接口，本期 YAGNI）。
- 错误码矩阵新增 `ACCOUNT_PASSWORD_MISMATCH`、`ACCOUNT_RATE_LIMITED`、`ACCOUNT_STORE_UNAVAILABLE`；`NICK_IN_USE` 收窄为 Agent 昵称冲突等剩余场景。
- `player:join` 载荷分裂为"会话分支 / 账号分支"两种形态；既有测试与 E2E 的 join 工具需统一补个人密码字段。
- ADR-0005 的"无有效会话一律 `NICK_IN_USE`"条款被本 ADR 决策一 supersede，其余条款（会话轮换、管理员接管、公共座位白名单等）继续有效。
