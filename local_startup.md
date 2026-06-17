# Local Startup

> 本文件记录本地开发和测试时前后端分别怎么启动。

## 前后端分开启动（推荐开发方式）

需要打开两个终端，工作目录都切到项目根目录：

```powershell
cd "d:\vscode html\take_time"
```

### 1. 启动后端

```powershell
npm run dev
```

等价于：

```powershell
npm run dev -w @take-time/server
```

后端默认地址：

```text
http://localhost:3000
```

健康检查：

```text
http://localhost:3000/healthz
```

### 2. 启动前端

另开一个终端：

```powershell
npm run dev -w @take-time/client
```

前端 Vite 默认地址：

```text
http://localhost:5173
```

本地联调时打开：

```text
http://localhost:5173
```

前端的 `/socket.io` 已在 `client/vite.config.ts` 里代理到后端 `http://localhost:3000`，所以访问 `5173` 即可联调前后端。

## 单服务模式（模拟 Railway 部署）

如果想模拟线上部署方式，也就是后端 Express 托管构建后的前端静态文件：

```powershell
npm run build
npm start
```

然后打开：

```text
http://localhost:3000
```

这种模式下前端来自 `client/dist`，Socket.IO 和页面都走同一个后端服务。

## 常用验证命令

类型检查：

```powershell
npm run typecheck
```

运行测试：

```powershell
npm test
```

运行前端 Playwright E2E：

```powershell
npm run test:e2e -w @take-time/client
```

## 日常开发建议

最常用组合：

```powershell
# 终端 1
npm run dev

# 终端 2
npm run dev -w @take-time/client
```

然后用两个浏览器窗口或两个不同浏览器访问：

```text
http://localhost:5173
```

分别输入两个不同昵称，即可测试双人本地流程。
