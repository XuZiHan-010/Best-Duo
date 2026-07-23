# 玩家改密、账号找回与管理员维护设计

> 状态：**已被替代**——恢复密钥主路径与管理员一次性凭证方案不再作为现行设计；以 [邮箱身份与账号恢复设计](2026-07-20-email-identity-recovery-and-admin-management-design.md) 为准。  
> 日期：2026-07-20  
> 架构决策：[ADR-0007](../docs/adr/0007-account-password-lifecycle-and-admin-management.md)  
> 前置决策：[ADR-0005](../docs/adr/0005-player-identity-and-admin-seize.md) · [ADR-0006](../docs/adr/0006-player-accounts-and-deferred-agent-memory.md)
> 前端交互原型：`/prototype/account-admin`（本地模拟数据，不连接 Socket，不修改真实账号或房间）

## 1. 目标与非目标

### 目标

1. 玩家记得旧密码时，可以安全修改密码。
2. 玩家忘记密码时，可以用注册时保存的恢复密钥自助找回；恢复密钥丢失时，由管理员签发一次性重置凭证协助恢复。
3. 管理员可以查看账号状态、强制登出、停用、恢复、发起密码重置和软删除。
4. 任何人（包括管理员）都不能查看原密码。
5. 改密、找回和管理员操作都能立即撤销旧会话，并具有审计、限流和并发安全。
6. 管理员查看账号不会进入、清空或中断房间。

### 非目标

- 本期不接入邮箱、手机验证码、OAuth 或第三方账号平台。
- 本期不开放玩家改昵称、改 `playerId` 或合并账号。
- 本期不建设多管理员 RBAC 管理平台；仅预留 scope。
- 本期不把 JSON 迁移到 PostgreSQL，但 repository API 必须允许 M9.5/M10 替换存储实现。

## 2. 角色与权限矩阵

| 能力 | 未登录访客 | 已登录玩家本人 | 管理员 |
| --- | --- | --- | --- |
| 正常注册/登录 | 是，需房间密码 | — | — |
| 修改本人密码 | 否 | 是，需旧密码 | 否 |
| 使用恢复密钥找回 | 是，需房间密码 + 恢复密钥 | 是 | 不代替用户执行 |
| 查看账号列表/状态 | 否 | 仅本人安全摘要 | 是，字段脱敏 |
| 签发一次性重置凭证 | 否 | 否 | 是 |
| 查看原密码/摘要/恢复密钥 | 否 | 否 | 否 |
| 强制登出 | 否 | 可登出自己的其他会话 | 是 |
| 停用/恢复账号 | 否 | 否 | 是 |
| 软删除账号 | 可申请，V1 不做自助入口 | 否 | 是，二次确认 |
| 物理删除 | 否 | 否 | 仅离线运维、依赖检查后 |

## 3. 三条用户流程

### 3.1 已登录修改密码

入口：主界面用户菜单 → “账号安全”。

表单：当前密码、新密码、确认新密码。

服务端顺序：

1. 验证当前 `playerId + reconnectToken`，确保操作者是账号本人。
2. 校验账号为 `active`。
3. 异步 scrypt 验证当前密码；失败走账号限流并返回统一错误。
4. 校验新密码 8–64 字符，且不得等于当前密码。
5. 用当前 KDF 参数生成新盐和摘要，递增 `credentialVersion`，更新 `passwordChangedAt`。
6. 原子持久化成功后，撤销该 `playerId` 的旧会话，并为当前座位签发新 `reconnectToken`。
7. 通过现有 `player:session` 事件把新令牌交给当前客户端；当前玩家不被踢出正在进行的游戏。
8. 写入不含敏感信息的 `account:password_changed` 审计日志。

默认不要求房间密码，因为有效玩家会话 + 当前个人密码已经构成两层证明。

### 3.2 使用恢复密钥自助找回

恢复密钥格式建议为 128 bit 随机值，分组展示，例如 `ABCD-EFGH-JKLM-NPQR-STUV-WXYZ`。它在注册成功时只展示一次，服务端保存 SHA-256 摘要。

入口：登录页 → “忘记个人密码” → `/account/recover`。

表单：昵称、房间密码、恢复密钥、新密码、确认新密码。

服务端顺序：

1. 先校验房间密码；失败时不查询账号、不计账号失败次数。
2. 按昵称 + 来源地址检查恢复限流。
3. 使用统一错误响应校验账号存在、状态为 `active`、恢复密钥匹配，避免泄露具体失败原因。
4. 写入新密码、递增 `credentialVersion`，消费旧恢复密钥。
5. 生成新的恢复密钥并只返回一次；玩家必须确认已保存。
6. 撤销该 `playerId` 全部旧会话；若账号当前占座，断开旧 socket 并释放/按玩家离开规则处理座位。
7. 写入 `account:recovered_with_key` 审计日志。

既有账号没有恢复密钥：玩家正常登录后，可在安全设置中验证当前密码并生成；若已经忘记密码，则走管理员协助流程。

### 3.3 管理员协助找回

管理员在账号列表中选择玩家 → “签发重置凭证”。系统生成至少 192 bit 的随机凭证，默认 30 分钟有效，只展示一次。

管理员把该凭证通过双方已有的可信沟通渠道交给玩家。玩家在 `/account/recover` 选择“管理员重置凭证”，输入昵称、房间密码、重置凭证和新密码。

成功后：

- 重置凭证立即失效；
- 新密码落盘并递增 `credentialVersion`；
- 全部旧会话撤销；
- 生成新的个人恢复密钥，只向玩家展示一次；
- 管理员只看到“已使用/已过期”，看不到玩家设置的新密码。

管理员再次签发会使同账号上一枚未使用凭证立即失效。

## 4. 管理员后台

### 4.1 认证与路由

保留 `/admin`，但修改语义：登录成功只设置当前 Socket 的 `socket.data.role = "admin"` 和最后活动时间，不自动调用接管房间。

后台包含两个视图：

- `/admin/accounts`：账号管理。
- `/admin/room`：房间状态、主动进入/接管、请出玩家。

管理员断线、刷新、服务重启或空闲超过 30 分钟后需要重新输入管理员账号密码。V1 不持久化管理员令牌，避免在浏览器保存高权限长期凭证。

房间管理保持 ADR-0005 的 `stateVersion` 和二次确认。管理员必须主动点击“进入/接管房间”后才产生游戏副作用。

### 4.2 账号列表字段

允许返回：

- `playerId`（界面缩略显示，复制需显式操作）
- 昵称、头像
- 状态：正常/停用/已删除
- 注册时间、密码最后修改时间、最后更新时间
- 是否配置恢复密钥
- 是否存在有效管理员重置凭证及其过期时间
- 是否当前在线/占座（来自房间状态的派生信息）

禁止返回：

- `passwordHash`、`passwordSalt`、KDF 原始字段
- 恢复密钥摘要
- 管理员重置凭证摘要或完整凭证
- 玩家 reconnect token

### 4.3 管理动作

#### 强制登出

撤销 `playerId` 的全部会话；在线玩家收到明确通知。若玩家正在对局，界面提示影响并二次确认。

#### 签发重置凭证

不修改密码，只创建短时单次凭证。凭证弹窗只显示一次，关闭后不可再次查看，只能重新签发。

#### 停用

将 `status` 改为 `disabled`、撤销会话、使未使用重置凭证失效。停用账号的昵称继续保留，不允许被重新注册。

#### 恢复

将 `disabled` 恢复为 `active`，但不恢复旧会话和已作废的重置凭证。若管理员怀疑账号已泄露，应同时签发新重置凭证。

#### 软删除

V1 的删除是不可登录的软删除：状态变为 `deleted`，清除头像、密码凭证、恢复凭证和管理员重置凭证，保留 `playerId` 与最小墓碑信息。界面需要输入目标昵称再次确认。

物理清除暂不提供网页按钮。未来 repository 能检查进度、统计、Agent memory 等外键后，再提供离线 purge 命令。

## 5. 数据模型与迁移

建议把 `accounts.json` 升级为 `schemaVersion: 2`：

```ts
interface PlayerAccountV2 {
  playerId: string;
  nick: string;
  avatar: string | null;
  status: "active" | "disabled" | "deleted";

  passwordSalt: string | null;
  passwordHash: string | null;
  kdf: AccountKdfParams | null;
  credentialVersion: number;

  recoveryKeyHash: string | null;
  recoveryKeyCreatedAt: number | null;

  adminResetTokenHash: string | null;
  adminResetIssuedAt: number | null;
  adminResetExpiresAt: number | null;

  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
  disabledAt: number | null;
  deletedAt: number | null;
}
```

迁移规则：

- v1 → v2：保留原密码字段；`status = active`、`credentialVersion = 1`、恢复与重置字段为 `null`；`updatedAt/passwordChangedAt` 暂取原 `createdAt`。
- 迁移先在内存完整验证，再通过临时文件 + rename 原子提交；写入前保留 `.bak`。
- 迁移失败进入 fail-closed，原文件原样保留。
- 不允许“部分记录跳过继续启动”，否则可能让昵称被重复注册。

## 6. 服务端接口边界

把当前 `AccountStore` 扩展/重命名为 `AccountRepository`，对业务层暴露安全投影，不把含摘要的完整记录传给 Socket handler。

```ts
interface AccountRepository {
  verifyOrRegister(input: VerifyOrRegisterInput): Promise<VerifyResult>;
  verifyPassword(playerId: string, password: string): Promise<VerifyPasswordResult>;
  changePassword(input: ChangePasswordInput): Promise<AccountMutationResult>;
  recoverWithKey(input: RecoverWithKeyInput): Promise<RecoveryResult>;
  recoverWithAdminToken(input: RecoverWithAdminTokenInput): Promise<RecoveryResult>;
  rotateRecoveryKey(playerId: string): Promise<RecoveryKeyResult>;

  listForAdmin(query: AdminAccountQuery): Promise<AdminAccountPage>;
  issueAdminReset(playerId: string): Promise<OneTimeResetToken>;
  revokeAdminReset(playerId: string): Promise<void>;
  setStatus(playerId: string, status: "active" | "disabled"): Promise<void>;
  softDelete(playerId: string): Promise<void>;
}
```

所有 mutation 经单一串行队列执行。先持久化成功，再对会话和房间产生副作用；持久化失败时不得出现“内存已改、磁盘未改”的半成功。

`PlayerSessionStore` 补充：

- `revokeByPlayerId(playerId)`（可复用现有 `revoke`，但用业务语义命名）；
- 改密成功后为当前座位重新 `issue`；
- 管理员停用/软删除时撤销会话并通知/断开目标 socket；
- 未来若会话持久化，验证时比较 `credentialVersion`。

## 7. Socket 事件草案

### 玩家事件

- `account:changePassword`
- `account:rotateRecoveryKey`
- `account:recoverWithKey`
- `account:recoverWithAdminToken`
- `account:logoutOtherSessions`

服务端响应：

- `account:actionResult`
- `account:recoveryKeyIssued`（只返回一次）
- 复用 `player:session` 下发改密后的新会话

### 管理事件

- `admin:login`：只认证，无房间副作用
- `admin:accounts:list`
- `admin:accounts:issueReset`
- `admin:accounts:revokeReset`
- `admin:accounts:forceLogout`
- `admin:accounts:setStatus`
- `admin:accounts:softDelete`
- `admin:room:enter`：显式进入/接管房间

所有 payload 使用 `.strict()` Zod schema，限制字符串长度；账号管理事件必须先检查管理员身份、scope 和空闲超时。

## 8. 错误码与防枚举

建议新增：

- `ACCOUNT_CURRENT_PASSWORD_MISMATCH`
- `ACCOUNT_PASSWORD_POLICY_FAILED`
- `ACCOUNT_RECOVERY_FAILED`（账号不存在、密钥错误、重置凭证错误/过期统一使用）
- `ACCOUNT_DISABLED`
- `ACCOUNT_DELETED`
- `ACCOUNT_RESET_TOKEN_EXPIRED`
- `ACCOUNT_ADMIN_ACTION_FORBIDDEN`
- `ACCOUNT_CONCURRENT_UPDATE`

公开恢复页尽量使用 `ACCOUNT_RECOVERY_FAILED` 统一文案：“账号信息或恢复凭证不正确”。管理员后台可以看到目标账号不存在等精确信息，但不显示任何凭证内容。

## 9. 密码与凭证安全参数

- 新密码：8–64 字符；不 trim，不做字符类型组合要求；禁止与当前密码相同。
- 人类密码：异步 scrypt，沿用版本化 N/r/p/keylen；每次成功改密使用当前最新参数重哈希。
- 恢复密钥：至少 128 bit CSPRNG；服务端保存 SHA-256 摘要。
- 管理员重置凭证：至少 192 bit CSPRNG；保存 SHA-256 摘要；30 分钟 TTL；单账号同时仅一枚有效。
- 比较摘要统一使用恒定时间比较。
- 玩家失败限流：同昵称/playerId 60 秒 5 次，并叠加来源地址限制。
- 管理员登录：沿用 60 秒 5 次；生产环境要求管理员密码至少 12 字符且不得与房间密码相同。
- 日志、telemetry、`room:state`、错误对象均不得包含密码、摘要、恢复密钥或重置凭证。

## 10. UI 草案

### 玩家安全设置

- 修改密码
- 恢复密钥状态：“已配置/未配置”，不回显原密钥
- “生成/轮换恢复密钥”：验证当前密码后生成，醒目提示“只显示一次”
- “退出其他设备”

### 找回密码页

- 两种方式切换：“恢复密钥”“管理员重置凭证”
- 两种方式都要求昵称、房间密码、新密码和确认密码
- 成功页显示新的恢复密钥，要求勾选“我已保存”后才能返回登录页

### 管理员账号页

- 搜索、状态筛选、分页
- 行操作：签发重置凭证、强制登出、停用/恢复、软删除
- 高风险操作使用目标昵称二次确认
- 在线/对局中的账号显示额外警告
- 不出现“查看密码”或“设置永久密码”按钮

## 11. 实施阶段

### Phase 1：仓库与迁移

- [ ] 编写 ADR-0007 评审测试清单并确认恢复路径。
- [ ] 将账号文件升级为 schema v2，实现显式 v1 → v2 迁移。
- [ ] 扩展 repository API、串行 mutation 和安全投影。
- [ ] 覆盖迁移、原子写、`.bak`、损坏 fail-closed 和并发 mutation 测试。

### Phase 2：用户改密与恢复

- [ ] 新增玩家事件、schema、限流和错误码。
- [ ] 实现已登录改密、会话重新签发。
- [ ] 实现恢复密钥生成、自助恢复和既有账号补领。
- [ ] 增加安全设置页与找回密码页。

### Phase 3：管理员后台解耦

- [ ] 把 `admin:login` 改为纯认证，不自动接管。
- [ ] 增加管理员会话空闲过期和 scope 检查。
- [ ] 将房间接管改为显式 `admin:room:enter`。
- [ ] 实现账号列表、重置凭证、强制登出、停用/恢复和软删除。
- [ ] 完成 `/admin/accounts` 与 `/admin/room` 两个视图。

### Phase 4：验收与运维

- [ ] 完成 Socket 单元/集成测试和 Playwright E2E。
- [ ] 在 v1 账号副本上演练迁移、回滚和 `.bak` 恢复。
- [ ] 补充 Railway Volume 备份与损坏恢复 runbook。
- [ ] 更新 README、架构文档和部署环境变量说明。

## 12. 核心验收标准

1. 已登录玩家输入错误旧密码不能改密；正确改密后当前游戏不中断，旧令牌立即失效。
2. 房间密码错误时，恢复请求不触达账号仓库，也不能探测昵称是否存在。
3. 恢复密钥和管理员重置凭证都只能使用一次；重放必定失败。
4. 管理员无法从任何 API、日志或 UI 获得密码、摘要或已关闭的一次性凭证。
5. 管理员登录和查看账号不会清房、入座或改变 `room.stateVersion`。
6. 停用账号后，密码登录、会话重连和两种恢复方式均失败；恢复账号不会恢复旧会话。
7. 软删除后昵称不能被隐式重新注册，旧 `playerId` 不会指向新真人。
8. v1 账号文件能无损迁移；损坏或未知版本继续 fail-closed，且不覆盖原文件。
9. 两个并发改密/重置请求最多一个成功，后完成的旧请求不能覆盖新凭证。
10. 服务重启后密码、账号状态和恢复/重置凭证状态保持一致；内存会话按现行规则失效。

## 13. 推荐交付边界

优先交付 Phase 1–3 的最小闭环：

- 玩家：改密、恢复密钥找回；
- 管理员：无副作用登录、列表、签发重置凭证、强制登出、停用/恢复；
- 删除：先只做软删除，物理 purge 延后；
- 邮件找回、多管理员 RBAC、改昵称继续不做。

这个边界既解决真实的账号自锁和运维问题，又不会把单房间原型扩张成完整身份平台。
