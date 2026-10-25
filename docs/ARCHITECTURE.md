# 5DMind 技术架构

## 当前选型

5DMind 从第一版开始按可打包桌面软件的结构开发，而不是把 Web 原型做成一次性页面。

```text
React + TypeScript + Vite
          |
     领域服务接口
   /        |          \
Web 本地   Tauri IPC    云端适配器
IndexedDB  Rust/SQLite  HTTP / SSE
   |          |             |
浏览器     Windows EXE   NestJS 服务端
           / MSI          模型网关与同步
```

### 前端框架

- React：聊天、抽屉、比较视图和可访问性 UI。
- TypeScript：统一领域模型与服务接口。
- Vite：Web 开发、测试和静态资源构建。

### 桌面框架

- Tauri 2：生成 Windows NSIS 安装包和 MSI。
- Rust 层负责窗口、系统能力、本地 SQLite、Provider transport 和安全边界；桌面端的本地事实源不依赖 Node 服务。Provider 的 HTTP/SSE/NDJSON 只在 Rust ModelGateway 内部使用，token 通过 Tauri IPC Channel 返回 React。
- 前端在浏览器和桌面 WebView 中复用同一套 React 代码。

### 后端框架边界

NestJS 是可选的云端服务，不是桌面或移动端应用的本地后端。桌面和移动端的模型调用由 Rust ModelGateway 负责，凭据按平台使用系统凭据库或应用私有存储；NestJS 继续承担未来账号、权限和同步能力。当前云端服务仍使用内存仓储，模型网关未接入时返回明确的 503 错误状态。服务端继续遵循以下边界：

- 采用 NestJS 模块化单体和 Fastify adapter，不先拆微服务。
- PostgreSQL 保存领域事实，Drizzle 管理 schema 与迁移。
- 普通命令和查询使用 REST，模型流式输出使用 SSE。
- 服务端实现对接文档修正后的领域契约，本地与远程适配器共享契约测试。
- React 组件只替换基础设施适配器，不直接改写。

详细方案见：

- [前后端对接文档](BACKEND_INTEGRATION.md)
- [后端框架要求与架构设计](BACKEND_ARCHITECTURE.md)
- [前后端集成状态与缺口](INTEGRATION_STATUS.md)

## 本地数据演进

1. Web：IndexedDB，保证浏览器原型无需本地服务即可运行。
2. 桌面 MVP：SQLite + Tauri command，当前已接入 `load_workspace`、`save_workspace`、`reset_workspace`、系统凭据 commands 和本地 ModelGateway。
3. 账号同步：本地事件日志与云端增量同步。

## 命令

```bash
npm run dev:web
npm run dev:desktop
npm run build:web
npm run build:desktop
```
