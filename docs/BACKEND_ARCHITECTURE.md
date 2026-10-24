# 5DMind 后端框架要求与架构设计

> 状态：架构决策提案 v0.1  
> 结论：云端采用模块化单体，不从微服务开始；桌面端继续使用 Tauri，不在 EXE 中嵌入 Node.js 服务。

## 1. 设计目标

后端首先服务于“普通对话 + 时间线地图”这个核心体验，而不是成为一套通用 AI 平台。

必须支持：

- 对话、分支、引用、合并摘要和风险的可靠持久化。
- 模型流式输出、取消、错误恢复和用量统计。
- Web 与 Tauri 桌面端共用协议。
- 未来账号同步和多人协作能够演进，但不提前引入分布式复杂度。
- 领域逻辑可以在本地适配器和远程服务之间复用或做契约一致性测试。

当前不做：

- 微服务拆分、服务网格和多区域部署。
- 复杂工作流引擎。
- 实时多人编辑和 CRDT。
- 自建模型推理集群。
- 将云端 API 打包进每个 Windows EXE。

## 2. 推荐技术栈

### 2.1 云端 API

| 层次 | 选型 | 要求 |
| --- | --- | --- |
| 运行时 | Node.js Active LTS | 使用 ESM、锁定版本、启用严格 TypeScript |
| 主框架 | NestJS，Fastify adapter | 模块边界、依赖注入、守卫、拦截器和测试支持 |
| 协议 | REST + SSE | OpenAPI 3.1；SSE 用于模型单向流式输出 |
| 校验 | Zod | 请求、响应和共享契约必须有运行时校验 |
| 数据库 | PostgreSQL 16+ | 关系、事务、递归查询和 JSONB 元数据 |
| ORM | Drizzle ORM | 显式 SQL 模型、类型安全迁移，避免隐藏查询 |
| 日志 | Pino | 结构化日志和请求关联 ID |
| 可观测性 | OpenTelemetry | HTTP、数据库、模型调用链路和指标 |
| 测试 | Vitest + Testcontainers | 单元、契约和真实 PostgreSQL 集成测试 |
| 部署 | OCI/Docker 镜像 | API 与数据库独立于桌面安装包发布 |

选择 NestJS + Fastify 的原因：

- NestJS 为账号、权限、模型网关和未来同步提供清楚的模块边界。
- Fastify 比默认 Express adapter 更适合长连接、Schema 校验和较低开销。
- 当前团队仍可以保持一个可部署单元，不承担微服务的网络和运维成本。
- TypeScript 可以与前端共享契约，但不能共享含数据库或框架依赖的实现代码。

如果后端范围长期只有单用户和少量路由，可以直接使用 Fastify。当前设计仍推荐 NestJS，是因为产品路线已包含账号、同步、模型供应商和桌面设备管理。

### 2.2 桌面端

Windows 软件保持当前结构：

```text
5DMind.exe / MSI / NSIS
  ├─ Tauri 2 Rust 壳
  ├─ React 静态资源
  ├─ 本地 SQLite（桌面 MVP）
  ├─ 系统安全凭据存储
  └─ HTTPS 连接云端 API（可选）
```

要求：

- Tauri Rust 层只承担窗口、文件、系统凭据、本地数据库和安全边界。
- 云端领域服务不编译进 Tauri；EXE 离线时使用本地适配器。
- 不在桌面安装包中附带一个长期运行的 Node.js 进程。
- 本地 SQLite 与 IndexedDB 之间必须有一次性迁移器。
- 当前 `csp: null` 只允许用于原型，正式包必须启用 CSP 和明确的 `connect-src`。

## 3. 总体架构

```text
Web / Tauri React
       |
       | HTTPS REST + SSE
       v
NestJS Modular Monolith
  ├─ Auth & Workspace
  ├─ Conversations
  ├─ Timelines
  ├─ Messages / Turns
  ├─ References
  ├─ Threats
  ├─ Model Gateway
  └─ Sync（后期）
       |
       | transaction / outbox
       v
PostgreSQL
       |
       +-- Object Storage（附件阶段）
       +-- Redis / Queue（确有后台任务后再引入）
```

第一阶段不要求 Redis。模型生成由 API 实例直接管理，数据库保存任务状态和可重放事件。只有出现以下需求时再引入队列：

- 长时间运行的批量任务。
- API 重启后必须继续生成。
- 大规模文档解析或嵌入任务。
- 跨实例调度和明确的重试策略。

## 4. 代码组织

建议采用 monorepo，但前后端是独立构建目标：

```text
apps/
  web/                     React + Vite
  desktop/                 Tauri
  api/                     NestJS + Fastify
packages/
  contracts/               Zod schemas、DTO、事件类型
  domain/                  无框架的纯领域规则
  test-contracts/          本地与远程适配器一致性测试
```

API 内部按领域模块组织，不按 Controller/Service/Repository 全局分层：

```text
apps/api/src/modules/timelines/
  timelines.module.ts
  http/
    timelines.controller.ts
    timeline.schemas.ts
  application/
    fork-timeline.use-case.ts
    compare-timelines.use-case.ts
    merge-summary.use-case.ts
  domain/
    timeline-policy.ts
  infrastructure/
    timeline.repository.ts
    drizzle-timeline.repository.ts
```

依赖方向：

```text
HTTP / SSE -> Application -> Domain
                         ^
                         |
                 Infrastructure adapters
```

领域层不能导入 NestJS、Drizzle、模型 SDK 或 HTTP 类型。Controller 只负责认证、校验和协议映射，不编写上下文计算逻辑。

## 5. 后端模块职责

### Conversations

- 创建、列表、归档和标题更新。
- 提供一个对话的聚合图快照。
- 校验用户或工作区对资源的访问权限。

### Timelines

- 创建主线和分支。
- 维护父时间线、分支点与上下文模式。
- 计算可见节点、共同祖先和分支差异。
- 生成合并摘要节点，但不删除来源分支。

### Messages / Turns

- 在事务中创建用户节点、助手占位节点和 Turn。
- 管理消息状态：`pending -> streaming -> complete | failed`。
- 提供 SSE、取消和断线恢复。
- 保存模型、耗时和令牌用量，不泄露供应商原始结构。

### References

- 创建来源快照和显式引用边。
- 校验跨对话引用权限。
- 提供地图需要的引用关系。

### Threats

- 创建、解决和重新打开风险。
- 使用版本号避免不同设备相互覆盖。
- 保留解决说明和审计时间。

### Model Gateway

- 将 OpenAI、Anthropic 或本地模型适配为统一流接口。
- 负责超时、取消、限流、重试和用量归一化。
- 组装服务端权威上下文。
- 不允许 Controller 直接调用模型 SDK。

示例端口：

```typescript
interface ModelGateway {
  stream(input: {
    model: string;
    messages: ModelMessage[];
    signal: AbortSignal;
    requestId: string;
  }): AsyncIterable<
    | { type: "delta"; text: string }
    | { type: "usage"; inputTokens: number; outputTokens: number }
  >;
}
```

## 6. 数据模型

### 6.1 核心表

| 表 | 核心字段 |
| --- | --- |
| `conversations` | `id`, `workspace_id`, `title`, `summary`, `version`, timestamps |
| `timelines` | `id`, `conversation_id`, `parent_timeline_id`, `forked_from_node_id`, `context_mode`, `status` |
| `conversation_nodes` | `id`, `timeline_id`, `parent_node_id`, `kind`, `relation`, `content`, `summary`, `status`, `focus_selection`, `metadata` |
| `node_sources` | `node_id`, `source_node_id`, `source_type`, `position` |
| `reference_links` | `id`, `source_node_id`, `target_node_id`, `label` |
| `threats` | `id`, `conversation_id`, `node_id`, `severity`, `status`, `resolution`, `version` |
| `turns` | `id`, `timeline_id`, `user_node_id`, `assistant_node_id`, `status`, model and usage fields |
| `turn_events` | `turn_id`, `sequence`, `event_type`, `payload`, `created_at` |
| `idempotency_records` | principal, route, key, request hash, response reference, expiry |
| `outbox_events` | aggregate, event type, payload, publish status |

`metadata` 只放可选展示信息，例如模型名、作者快照和标签。关系、状态、权限、排序与查询字段必须有正式列，不能全部塞入 JSONB。

### 6.2 关键约束

- 同一节点只能属于一条创建时间线，但可以被其他时间线继承可见。
- `parent_node_id` 必须指向同一对话中的可达节点。
- `forked_from_node_id` 必须在父时间线的可见上下文中。
- `focused-inquiry` 根节点必须带 `inquiry_root_id` 与 `focus_selection`；后续节点只能引用同一追问树，来源节点必须是当前时间线可见的助手节点。
- `focus_selection` 保存选中文本快照和内容哈希，不依赖原消息后续是否被编辑。
- `source_node_id != target_node_id`。
- 节点、时间线和引用不能形成非法环。
- 完成的模型消息不能再追加 delta；编辑应产生修订。
- 删除默认使用归档或墓碑，避免同步后重新出现。

### 6.3 索引

至少建立：

- `timelines(conversation_id, status, created_at)`
- `conversation_nodes(timeline_id, created_at)`
- `conversation_nodes(parent_node_id)`
- `conversation_nodes(inquiry_root_id)`
- `reference_links(source_node_id)` 和 `(target_node_id)`
- `threats(conversation_id, status)` 和 `(node_id)`
- `conversation_nodes(timeline_id, relation, created_at)` 和 `conversation_nodes((focus_selection->>'sourceNodeId'))`
- `turn_events(turn_id, sequence)` 唯一索引
- 幂等记录的主体、路由和键联合唯一索引

## 7. 事务边界

必须在单个数据库事务中完成：

- 创建对话与默认主线。
- 创建一轮对话所需的用户节点、助手占位节点和 Turn。
- 创建引用节点与引用边。
- 创建合并节点与所有来源关系。
- 领域写入与 Outbox 事件写入。

不能把模型网络调用放进事务。正确顺序：

1. 校验请求并提交占位节点。
2. 返回 Turn 标识和事件地址。
3. 调用模型并分批提交事件与正文。
4. 完成、失败或取消时更新最终状态。

## 8. 本地优先与同步

桌面 MVP 先使用 SQLite 作为本地事实来源。账号同步启用后采用操作日志，而不是持续上传整个 `WorkspaceSnapshot`。

每个本地写操作至少包含：

- `clientMutationId`
- `deviceId`
- `aggregateId`
- `baseVersion`
- 操作类型和负载
- 客户端时间，仅用于展示，不能替代服务端排序

冲突策略：

- 消息、分支和引用以追加为主，天然合并。
- 标题等简单字段可以最后写入者胜出，但保留修订记录。
- 风险状态使用乐观版本锁，冲突时要求用户确认。
- 删除使用墓碑。
- 不对消息图使用通用 CRDT；先以明确领域操作同步。

## 9. 安全要求

- 所有生产流量使用 TLS；数据库不暴露公网。
- 模型密钥存放于服务器密钥管理系统，只在 Model Gateway 读取。
- Tauri 只保存 5DMind 会话令牌，并使用系统凭据存储。
- 按用户和工作区校验每个对话、节点、引用和附件。
- 请求正文、附件数量和消息长度必须限额。
- 用户配置的模型代理地址必须做 SSRF 防护和目标白名单。
- 日志默认不记录消息正文、系统提示词、访问令牌和模型密钥。
- 导出、删除、跨工作区引用和共享操作进入审计日志。
- 正式 Tauri 包启用 CSP，只允许已配置 API 和资源域名。
- CORS 只允许受控 Web 域名和实际桌面 WebView origin。

## 10. 可观测性与运行指标

每个请求和 Turn 贯穿同一个 `requestId`/`traceId`。至少记录：

- API 延迟、状态码和错误码。
- 数据库查询耗时与慢查询。
- 模型首字延迟、总耗时、取消率和供应商错误率。
- 输入/输出令牌和估算成本。
- 活跃 SSE 数量、断线和重连次数。
- 幂等命中率和版本冲突率。

初期目标：

- 非模型 API 的服务端 p95 小于 250 ms。
- Turn 创建确认 p95 小于 300 ms。
- 模型网关额外首字开销小于 150 ms，不含供应商耗时。
- SSE 每 15 秒心跳，代理空闲超时不少于 60 秒。
- 单条文本消息默认上限 200 KiB，超限返回明确错误。

## 11. 测试要求

### 单元测试

- 三种上下文继承模式。
- 分支可达性和环检测。
- 时间线比较、引用快照和合并来源。
- 风险状态机和版本冲突。
- 模型事件到 `MessageEvent` 的映射。

### 集成测试

- 使用 Testcontainers 启动真实 PostgreSQL。
- 验证事务回滚、约束、索引和并发更新。
- 验证幂等重放不会生成重复节点。
- 验证 SSE 顺序、取消、断线恢复和 UTF-8 中文分片。

### 契约测试

同一套用例必须同时运行在：

- IndexedDB、Tauri SQLite 与远程适配器。
- Tauri SQLite 适配器。
- HTTP/SSE 适配器。

这样才能保证替换基础设施后，聊天和地图组件行为不变。

## 12. 实施阶段

### 阶段 A：整理前端边界

- 修正领域端口的输入和返回值。
- 从 `WorkspaceProvider` 移出直接写实体的逻辑。
- 为本地适配器建立契约测试。

### 阶段 B：单机远程服务

- NestJS + Fastify 项目骨架。
- PostgreSQL schema 和迁移。
- 对话图、分支、引用、风险和比较接口。
- Model Gateway 错误流与 SSE。

### 阶段 C：真实模型

- 接入第一个模型供应商。
- 取消、超时、限流、用量和错误映射。
- 完成模型网关集成测试。

### 阶段 D：桌面本地数据库

- IndexedDB 迁移到 SQLite。
- Tauri command 适配器和系统凭据存储。
- 离线启动、崩溃恢复和安装包升级测试。

### 阶段 E：账号与同步

- OIDC、工作区权限和设备标识。
- 操作日志、增量同步和冲突 UI。
- 此阶段之后再评估 Redis、后台队列和多人实时通道。

## 13. 明确不采用的方案

- **不先拆微服务**：当前领域边界仍在验证，拆分只会增加事务和调试成本。
- **不让前端直连模型厂商**：密钥、配额、审计和供应商切换无法可靠控制。
- **不把 WebSocket 用于所有请求**：普通命令和查询使用 REST 更易测试、缓存和观测。
- **不把完整 Node 后端塞进 EXE**：安装、升级、端口、安全和进程生命周期成本过高。
- **不上传完整快照做同步**：会产生覆盖冲突和不必要流量，应同步领域操作。
- **不把时间线复制成多份消息**：继承关系必须显式，避免重复数据和编辑漂移。
