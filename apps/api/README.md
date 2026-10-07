# 5DMind API

云端 API 是 NestJS + Fastify 的模块化单体，协议前缀为 `/api/v1`。当前实现使用内存领域仓储跑通 Web/Tauri 联调闭环；`src/infrastructure/db/schema.ts` 和 `drizzle/` 提供 PostgreSQL + Drizzle 的持久化结构，接入真实数据库时不需要改变 HTTP 契约。

## 本地运行

在仓库根目录执行：

```bash
npm install
npm run dev:api
```

服务默认监听 `http://127.0.0.1:3000`，健康检查为 `/api/v1/health`，OpenAPI 3.1 JSON 为 `/api/v1/openapi.json`。

## 核心请求顺序

1. `POST /api/v1/conversations` 创建对话，服务端同时创建主线。
2. `GET /api/v1/conversations/:conversationId/graph` 读取图快照。
3. `POST /api/v1/timelines/:timelineId/turns` 创建用户消息和助手占位节点；选区追问通过 `relation: "focused-inquiry"`、`focusSelection` 和 `inquiryRootId` 复用同一 Turn 契约。
4. `GET /api/v1/turns/:turnId/events` 通过 SSE 读取 `message.started`、`message.delta` 和终态事件，支持 `Last-Event-ID` 断线恢复。
5. `POST /api/v1/turns/:turnId/cancel` 主动取消生成，并将助手节点落为 `failed`。

所有写操作必须携带 `Idempotency-Key`，缺失时返回 `400 IDEMPOTENCY_KEY_REQUIRED`；同一个键对应不同请求体时返回 `409 IDEMPOTENCY_KEY_REUSED`。模型密钥不进入前端，也不写入普通日志。生产环境需要将 `AUTH_MODE` 切换到真实鉴权实现，并把内存仓储替换成数据库适配器。

## PostgreSQL / Docker

```bash
docker compose up --build
```

该 Compose 配置会同时启动 PostgreSQL 16 和 API。当前 API 仍使用内存仓储，`DATABASE_URL` 与迁移结构已经就绪，但生产 PostgreSQL repository 尚未接入。

Drizzle 迁移命令：

```bash
npm --workspace apps/api run db:migrate
```
