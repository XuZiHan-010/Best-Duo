# Best Duo Online

[中文](#best-duo-online) | [English](#best-duo-online-english)

一个私用的、非盈利的在线合作时钟谜题游戏原型，灵感来自 Libellud 的合作桌游《Take Time》。

我们是《Take Time》的爱好者，希望能和朋友远程一起体验类似的合作推理乐趣，所以做了这个 Web 版本。当前项目支持一个全局房间、2–4 个就位座位、真人与 Agent 混合座位框架、实时同步、关卡选择、暗置出牌、提示标记、揭示校验和已通关进度持久化。

## 版权与使用声明

本项目是非官方粉丝改编项目，与《Take Time》、Libellud 或其相关权利方没有从属、授权、赞助或背书关系。

项目仅用于个人学习、朋友间娱乐和技术实验，不用于商业用途，不售卖、不收费，也不意图替代正版桌游。喜欢这个游戏机制的玩家请支持正版桌游。

如果你是相关权利方，并认为本项目中的内容需要调整或移除，欢迎通过 issue 联系我们。

## 主要功能

- 单房间 2–4 人在线合作对局，房间固定 4 个座位并按实际就位人数开局。
- 玩家输入昵称后入座，准备后由第一个准备者成为房主。
- 房主选择关卡、开始对局、推进流程。
- 讨论阶段后进入禁沟通出牌阶段。
- 每名玩家拥有私有手牌视图；桌面暗置牌的数值由服务端遮蔽，颜色对全体玩家可见。
- 使用有限提示标记传递信息。
- 揭示后由服务端校验 6 个时钟区段的永久通用规则和当前关卡特殊条件。
- 已通关关卡和房间设置持久化到 JSON 文件。
- 发牌前使用求解器校验当前抽牌至少存在一种可行解，避免玩家拿到无解牌面。

## 自定义关卡

关卡文件放在 `levels/` 目录下，一关一个 Markdown 文件，例如：

```text
levels/level-01.md
levels/level-02.md
levels/level-03.md
```

你可以在 `levels/` 里设计自己的关卡。建议先阅读：

- `rules.md`：游戏规则和机制口径。
- `levels/README.md`：关卡格式、条件类型、区段编号约定。
- `docs/architecture.md`：当前系统架构、状态边界、Agent memory 与模型路由。
- `docs/take-time-web-prototype.md`：V1 双人状态机、Socket 事件和数据模型的历史基线。

新增关卡后，请同步更新 `levels/README.md` 的关卡列表。若只是调整某一关的数值条件，通常只需要修改对应的 `level-XX.md`；若要新增一种条件类型，则需要同步扩展 shared 类型、服务端条件校验和前端展示文案。

每一关都会自动叠加三条永久通用规则：6 个区段总和非递减、每个区段至少 1 张牌、每个区段总和不超过时钟中心值。关卡 Markdown 中通常只写该关自己的特殊条件。`centerCap` 省略或为 `null` 时默认是 24；只有显式写成 `"inf"` 时才表示没有每段上限。

可以用下面的命令评估关卡随机发牌的可解率：

```bash
npm run assess:levels -w @take-time/server
```

可选参数：

```bash
SAMPLES=10000 npm run assess:levels -w @take-time/server
LEVEL=3 npm run assess:levels -w @take-time/server
EXACT=1 npm run assess:levels -w @take-time/server
```

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Express + Socket.IO + TypeScript
- 共享类型：npm workspaces 中的 `shared` 包
- 测试：Vitest + Playwright
- 部署：Railway 单服务
- 持久化：Railway Volume 上的 JSON 文件

## 本地运行

需要 Node.js 20 或更高版本。

安装依赖：

```bash
npm ci
```

开发模式推荐前后端分开启动。

终端 1，启动后端：

```bash
npm run dev
```

后端默认地址：

```text
http://localhost:3000
```

健康检查：

```text
http://localhost:3000/healthz
```

终端 2，启动前端：

```bash
npm run dev -w @take-time/client
```

前端默认地址：

```text
http://localhost:5173
```

本地开发时打开 `http://localhost:5173`。Vite 会把 `/socket.io` 代理到 `http://localhost:3000`。

本地测试默认房间密码为 `1234`。

如果想模拟 Railway 的单服务部署模式：

```bash
npm run build
npm start
```

然后打开：

```text
http://localhost:3000
```

这种模式下，Express 会托管 `client/dist`，页面和 Socket.IO 都走同一个后端服务。

## 常用脚本

```bash
npm run build
```

构建 shared、client 和 server。

```bash
npm run typecheck
```

运行全仓 TypeScript 检查。

```bash
npm test
```

运行各 workspace 中已配置的测试。

```bash
npm run test:e2e -w @take-time/client
```

运行前端 Playwright E2E。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口。Railway 会自动注入。 |
| `HOST` | `0.0.0.0` | 服务监听地址。Railway 部署保持默认即可。 |
| `DATA_DIR` | `./data` | 进度 JSON 的保存目录。Railway 上应指向 Volume 挂载目录。 |
| `ROOM_PASSWORD` | `1234` | 房间密码。公开部署时建议设置为自己的值。 |
| `SEAT_HOLD_MS` | `60000` | 断线后座位保留时间，单位毫秒。 |
| `HINT_WINDOW_MS` | `5000` | 提示标记窗口时间，单位毫秒。 |
| `HOST_START_GRACE_MS` | `15000` | 房主开始关卡后的宽限时间，单位毫秒。 |
| `CLIENT_DIST_DIR` | `../../client/dist` | 后端运行时寻找前端构建产物的位置。通常不需要修改。 |

## Railway 部署

项目已经包含 `railway.json`，Railway 会使用：

```bash
npm ci && npm run build
```

作为构建命令，并使用：

```bash
npm start
```

作为启动命令。

部署步骤：

1. 在 Railway 创建新项目，并连接这个 GitHub 仓库。
2. 使用 Nixpacks 构建，保持仓库中的 `railway.json`。
3. 添加一个 Volume，用来保存通关进度和房间设置。
4. 将 `DATA_DIR` 设置为 Volume 的挂载路径，例如 `/data`。
5. 可选：设置 `ROOM_PASSWORD`，避免公开地址被陌生人进入。
6. 部署后访问 Railway 提供的域名，并检查 `/healthz` 是否返回 `ok: true`。

推荐 Railway 变量：

```text
DATA_DIR=/data
ROOM_PASSWORD=your-room-password
NODE_ENV=production
```

`PORT` 不需要手动设置，Railway 会自动注入。进行中的对局状态保存在服务端内存里，服务重启后会清空；已通关进度和设置会保存到 `DATA_DIR/progress.json`，只要该目录位于 Railway Volume 上，就能跨重启保留。

## 仓库结构

```text
client/   React 前端
server/   Express + Socket.IO 后端
shared/   前后端共享类型
levels/   关卡设计
docs/     产品与技术文档
plans/    执行计划和设计方案
data/     本地进度数据目录
```

## 项目状态

当前是 Web 原型阶段：双人 MVP 主流程可用，固定 4 座与 2–4 人弹性开局已基本落地，真实 LLM Agent 尚在 M9 实施阶段。当前架构与实施顺序分别见 `docs/architecture.md` 和 `plans/m9-agent-implementation-plan.md`。

---

# Best Duo Online English

[中文](#best-duo-online) | [English](#best-duo-online-english)

A private, non-commercial online cooperative clock puzzle prototype inspired by Libellud's cooperative board game *Take Time*.

We are fans of *Take Time* and wanted a way to enjoy a similar cooperative deduction experience remotely with friends, so we built this web version. The current project supports one global room, 2–4 occupied seats, a human/agent mixed-seat framework, real-time synchronization, level selection, hidden card placement, hint markers, reveal validation, and persisted cleared-level progress.

## Copyright And Use Notice

This is an unofficial fan adaptation project. It is not affiliated with, authorized by, sponsored by, or endorsed by *Take Time*, Libellud, or any related rights holders.

This project is intended only for personal learning, technical experimentation, and entertainment among friends. It is not for commercial use, is not sold or monetized, and is not intended to replace the official board game. If you enjoy this kind of game, please support the official board game.

If you are a relevant rights holder and believe that any content in this project should be adjusted or removed, please contact us through an issue.

## Features

- One-room cooperative play for 2–4 occupied seats, with four fixed seat slots and an elastic start count.
- Players enter with nicknames and take seats; the first ready player becomes the host.
- The host selects levels, starts the game, and advances the flow.
- After discussion, players enter a no-communication card placement phase.
- Each player has a private hand view. For face-down cards on the table, the server masks values while colors remain visible to everyone.
- Limited hint markers can be used to communicate information.
- After reveal, the server validates the permanent global rules and the current level-specific conditions for the 6 clock segments.
- Cleared levels and room settings are persisted to a JSON file.
- Before dealing, a solver checks that the randomly drawn cards have at least one valid solution, so players are not given impossible deals.

## Custom Levels

Level files live in the `levels/` directory. Each level is a Markdown file, for example:

```text
levels/level-01.md
levels/level-02.md
levels/level-03.md
```

You can design your own levels inside `levels/`. Before doing so, we recommend reading:

- `rules.md`: the source of truth for game rules and mechanics.
- `levels/README.md`: level format, condition types, and segment numbering conventions.
- `docs/architecture.md`: current system architecture, state boundaries, agent memory, and model routing.
- `docs/take-time-web-prototype.md`: historical V1 two-player baseline for the state machine, Socket events, and data model.

After adding a new level, update the level list in `levels/README.md`. If you only change numeric conditions for an existing level, you usually only need to edit the corresponding `level-XX.md`. If you add a new condition type, you will also need to update the shared types, server-side condition validation, and client display text.

Every level automatically receives three permanent global rules: the 6 segment sums must be non-decreasing, every segment must contain at least one card, and every segment sum must be at or below the clock center value. Level Markdown files usually only list that level's special conditions. If `centerCap` is omitted or `null`, it defaults to 24; only an explicit `"inf"` means there is no per-segment cap.

You can assess the random deal solvability rate for levels with:

```bash
npm run assess:levels -w @take-time/server
```

Optional parameters:

```bash
SAMPLES=10000 npm run assess:levels -w @take-time/server
LEVEL=3 npm run assess:levels -w @take-time/server
EXACT=1 npm run assess:levels -w @take-time/server
```

## Tech Stack

- Frontend: Vite + React + TypeScript
- Backend: Express + Socket.IO + TypeScript
- Shared types: the `shared` package in npm workspaces
- Testing: Vitest + Playwright
- Deployment: Railway single service
- Persistence: JSON file stored on a Railway Volume

## Local Development

Node.js 20 or newer is required.

Install dependencies:

```bash
npm ci
```

For development, we recommend running the frontend and backend separately.

Terminal 1, start the backend:

```bash
npm run dev
```

Default backend URL:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:3000/healthz
```

Terminal 2, start the frontend:

```bash
npm run dev -w @take-time/client
```

Default frontend URL:

```text
http://localhost:5173
```

Open `http://localhost:5173` during local development. Vite proxies `/socket.io` to `http://localhost:3000`.

The default local test room password is `1234`.

To simulate the Railway single-service deployment mode:

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:3000
```

In this mode, Express serves `client/dist`, and both the page and Socket.IO run through the same backend service.

## Common Scripts

```bash
npm run build
```

Builds shared, client, and server.

```bash
npm run typecheck
```

Runs TypeScript checks across the repository.

```bash
npm test
```

Runs configured tests in the workspaces.

```bash
npm run test:e2e -w @take-time/client
```

Runs the frontend Playwright E2E tests.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server listen port. Railway injects this automatically. |
| `HOST` | `0.0.0.0` | Server listen host. The default is fine for Railway. |
| `DATA_DIR` | `./data` | Directory where the progress JSON file is saved. On Railway, this should point to the Volume mount path. |
| `ROOM_PASSWORD` | `1234` | Room password. For public deployments, set your own value. |
| `SEAT_HOLD_MS` | `60000` | Seat hold time after disconnect, in milliseconds. |
| `HINT_WINDOW_MS` | `5000` | Hint marker window, in milliseconds. |
| `HOST_START_GRACE_MS` | `15000` | Grace period after the host starts a level, in milliseconds. |
| `CLIENT_DIST_DIR` | `../../client/dist` | Runtime path used by the backend to locate frontend build output. Usually does not need to be changed. |

## Railway Deployment

This repository includes `railway.json`. Railway will use:

```bash
npm ci && npm run build
```

as the build command, and:

```bash
npm start
```

as the start command.

Deployment steps:

1. Create a new Railway project and connect this GitHub repository.
2. Use Nixpacks and keep the repository's `railway.json`.
3. Add a Volume for cleared-level progress and room settings.
4. Set `DATA_DIR` to the Volume mount path, for example `/data`.
5. Optionally set `ROOM_PASSWORD` to prevent strangers from entering a public deployment.
6. After deployment, visit the Railway domain and check that `/healthz` returns `ok: true`.

Recommended Railway variables:

```text
DATA_DIR=/data
ROOM_PASSWORD=your-room-password
NODE_ENV=production
```

`PORT` does not need to be set manually; Railway injects it automatically. In-progress game state is kept in server memory and will be cleared when the service restarts. Cleared-level progress and settings are saved to `DATA_DIR/progress.json`; as long as that directory is on a Railway Volume, they will survive restarts.

## Repository Structure

```text
client/   React frontend
server/   Express + Socket.IO backend
shared/   Shared frontend/backend types
levels/   Level designs
docs/     Product and technical documents
plans/    Execution plans and design proposals
data/     Local progress data directory
```

## Project Status

This project is currently a web prototype. The two-player MVP flow is usable, and fixed four-seat / elastic 2–4-player support is mostly implemented. Real LLM agents remain part of the M9 implementation phase; see `docs/architecture.md` and `plans/m9-agent-implementation-plan.md`.
