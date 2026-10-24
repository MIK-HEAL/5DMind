# 5DMind 前后端对接文档

> 状态：提案 v0.1  
> 适用范围：Web 原型、Tauri 桌面端、未来云端 API  
> 目标：在不改写聊天和时间线地图组件的前提下，将本地持久化适配器替换为可选的真实远程服务。

## 1. 对接边界

前端组件不能直接依赖 HTTP、WebSocket、模型厂商 SDK 或数据库。所有外部能力都通过领域端口进入：

```text
React UI
   |
Workspace Facade / Store
   |
领域端口（Conversation / Timeline / Threat / Reference）
   |--------------------------|
本地适配器                    远程适配器
IndexedDB / Tauri SQLite      REST + SSE
```

以下状态只属于前端，不需要调用服务端：

- 当前打开的地图抽屉、固定状态和比较页签。
- 当前选中的地图节点。
- 当前查看的时间线。切换时间线只是读取已有数据和更新本地路由状态。
- 输入框草稿、滚动位置和消息操作栏状态。

服务端负责可持久化的领域事实：

- 对话、时间线和消息节点。
- 分支关系、节点来源和跨盘引用。
- 风险及其处理结果。
- 模型调用、流式事件和用量记录。
- 账号启用后的权限、同步版本和审计记录。

## 2. 当前契约与 v1 调整

当前接口位于 `src/domain/services.ts`，领域结构位于 `src/domain/types.ts`。它们支撑本地适配器和远程协议，但不应把 HTTP DTO 直接泄漏到 UI。

| 当前契约 | 问题 | v1 调整 |
| --- | --- | --- |
| `sendMessage(timelineId, content)` | 无幂等键、客户端消息 ID 和取消信号 | 改为 `SendMessageInput` 对象 |
| `forkFromMessage(messageId, name?)` | 丢失 UI 已支持的 `contextMode` | 使用 `ForkTimelineInput` |
| `switchTimeline()` | 这是展示状态，不是服务端领域操作 | 从远程服务移除 |
| `mergeSummary(): Promise<unknown>` | 无法安全消费结果 | 返回 `Promise<ConversationNode>` |
| 无 `ReferenceService` | 跨盘引用只能由 Provider 直接修改快照 | 增加引用端口 |
| Provider 直接修改大部分实体 | HTTP 适配器无法替换本地逻辑 | 将写操作移入 Facade/领域服务 |

建议的 v1 端口如下。该接口是前端依赖，不等同于 HTTP 路由：

```typescript
interface SendMessageInput {
  timelineId: string;
  content: string;
  clientMutationId: string;
  clientMessageId: string;
  parentNodeId?: string;
  signal?: AbortSignal;
}

interface ForkTimelineInput {
  messageId: string;
  name?: string;
  contextMode: "all" | "until-node" | "selected-only";
  clientMutationId: string;
}

interface ConversationService {
  createConversation(input: {
    title: string;
    clientMutationId: string;
  }): Promise<Conversation>;
  sendMessage(input: SendMessageInput): AsyncIterable<MessageEvent>;
  getContext(timelineId: string): Promise<ContextSnapshot>;
}

interface TimelineService {
  forkFromMessage(input: ForkTimelineInput): Promise<Timeline>;
  compareTimelines(ids: string[]): Promise<TimelineComparison>;
  mergeSummary(sourceIds: string[], targetId: string): Promise<ConversationNode>;
}

interface ThreatService {
  createThreat(input: CreateThreatInput & {
    clientMutationId: string;
  }): Promise<Threat>;
  resolveThreat(threatId: string, resolution: string): Promise<Threat>;
}

interface ReferenceService {
  createReference(input: {
    sourceNodeId: string;
    targetTimelineId: string;
    label?: string;
    clientMutationId: string;
  }): Promise<{ node: ConversationNode; link: ReferenceLink }>;
}
```

## 3. 协议约定

### 3.1 基础约定

- API 前缀：`/api/v1`。
- JSON 字段使用 `camelCase`，与 TypeScript 领域类型一致。
- ID 在协议中都是不透明字符串；推荐服务端使用 UUIDv7。
- 时间使用 UTC ISO 8601，例如 `2026-09-28T08:20:14.321Z`。
- 所有写请求携带 `Idempotency-Key`，值为客户端生成的 UUID。
- 所有响应携带 `X-Request-Id`；客户端日志只记录该 ID，不默认记录完整消息内容。
- 客户端不得依赖数据库自增顺序；消息顺序以父节点关系和服务端排序字段为准。
- API 不返回模型厂商的原始响应，厂商差异由模型网关归一化。

### 3.2 鉴权

原型阶段允许 `AUTH_MODE=disabled`，但远程部署必须支持：

```http
Authorization: Bearer <5dmind_access_token>
X-Device-Id: <installation_uuid>
```

模型厂商密钥不能进入 React 包、IndexedDB 或普通应用日志。桌面端保存 5DMind 登录令牌时应使用操作系统安全凭据存储，而不是 `localStorage`。

## 4. 最小 HTTP API

第一版只实现当前交互闭环，不提前设计管理后台、计费或多人协作接口。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/conversations` | 对话导航列表 |
| `POST` | `/conversations` | 创建对话及默认主线 |
| `GET` | `/conversations/:conversationId/graph` | 获取时间线、节点、风险和引用的聚合快照 |
| `GET` | `/timelines/:timelineId/context` | 获取模型实际使用的上下文快照 |
| `POST` | `/timelines/:timelineId/turns` | 创建用户消息和模型生成任务 |
| `GET` | `/turns/:turnId/events` | 读取模型流式事件 |
| `POST` | `/messages/:messageId/forks` | 从历史消息创建分支 |
| `POST` | `/timeline-comparisons` | 比较两条或多条时间线 |
| `POST` | `/timelines/:targetId/merge-summaries` | 将来源分支摘要写入目标线 |
| `POST` | `/references` | 创建跨盘引用节点和引用边 |
| `POST` | `/threats` | 创建风险 |
| `PATCH` | `/threats/:threatId/resolve` | 解决风险 |

`switchTimeline`、`selectNode` 和 `setMapOpen` 不出现在 API 中。

### 4.1 获取图快照

```http
GET /api/v1/conversations/conversation_123/graph
```

```json
{
  "version": 18,
  "conversation": {},
  "timelines": [],
  "nodes": [],
  "threats": [],
  "references": [],
  "serverTime": "2026-09-28T08:20:14.321Z"
}
```

MVP 可以返回完整图。数据量增加后使用 `afterVersion` 做增量读取，不按页面视图拆成多个相互竞争的请求。

### 4.2 创建一轮对话

前端先渲染乐观用户消息，再提交同一个 `clientMessageId`。服务端必须接受该 ID 或返回明确的 ID 映射，不能创建第二条用户消息。

```http
POST /api/v1/timelines/timeline_123/turns
Idempotency-Key: 790a8925-...
Content-Type: application/json
```

```json
{
  "clientMessageId": "node_0199...",
  "parentNodeId": "node_parent",
  "content": "比较两条时间线的结论",
  "model": "default"
}
```

```json
{
  "turnId": "turn_0199...",
  "userMessage": {
    "id": "node_0199...",
    "timelineId": "timeline_123",
    "kind": "user",
    "content": "比较两条时间线的结论",
    "status": "complete"
  },
  "assistantMessage": {
    "id": "node_0199...",
    "timelineId": "timeline_123",
    "kind": "assistant",
    "content": "",
    "status": "pending"
  },
  "eventsUrl": "/api/v1/turns/turn_0199.../events"
}
```

服务端在一个事务中写入用户节点、助手占位节点和生成任务，然后返回 `202 Accepted`。模型调用不占用数据库事务。

## 5. 流式输出

### 5.1 传输选择

模型输出使用 SSE 语义，客户端通过 `fetch()` 读取 `text/event-stream`。不使用原生 `EventSource`，因为桌面端需要设置 `Authorization` 请求头并支持显式取消。

WebSocket 暂不用于单向模型输出。以后只有在加入多人协作、在线状态或双向工具交互时再引入。

### 5.2 事件格式

```text
id: 1
event: message.started
data: {"turnId":"turn_1","message":{"id":"node_a","status":"streaming"}}

id: 2
event: message.delta
data: {"turnId":"turn_1","messageId":"node_a","sequence":1,"delta":"第一段"}

id: 3
event: message.completed
data: {"turnId":"turn_1","messageId":"node_a","usage":{"inputTokens":812,"outputTokens":226}}

```

允许的事件：

- `message.started`
- `message.delta`
- `message.completed`
- `message.failed`
- `turn.heartbeat`

规则：

- 同一 `turnId` 内 `sequence` 单调递增。
- 服务端每 15 秒发送心跳，代理层空闲超时不得低于 60 秒。
- 客户端使用 `AbortController` 停止读取；服务端收到断开后应取消上游模型请求。
- SSE 断线后客户端携带最后事件 ID重连；若事件已过期，则通过图快照恢复最终消息状态。
- `delta` 只包含新增文本，不能重复发送累计全文。

## 6. 分支、上下文与引用语义

### 6.1 分支

```json
{
  "name": "分支 A · 两周交付",
  "contextMode": "until-node",
  "clientMutationId": "..."
}
```

服务端必须验证：

- 分支点存在且属于同一对话。
- 父时间线和分支点之间存在可达关系。
- 不允许形成时间线或节点环。
- `selected-only` 只继承分支点；`until-node` 继承可见路径至分支点；`all` 继承父线全部可见上下文。

上下文计算必须只有一个权威实现。上线后建议由服务端计算，前端 selector 仅用于离线模式和预览。

### 6.2 跨盘引用

引用操作生成两个持久对象：

1. 目标时间线上的 `kind: "reference"` 节点。
2. 从源节点指向目标节点的 `ReferenceLink`。

引用节点保存创建时的正文快照，避免源内容被编辑后历史结论无声变化；同时保留 `sourceNodeId` 以便查看最新来源。

### 6.3 选区追问与聚焦树

选区追问是消息节点的附属探索，不默认创建新的顶级对话或时间线。前端把它存为当前时间线中的一组特殊节点，地图只在用户点击牌堆后展开其中一棵树。

节点增加以下可选字段：

```typescript
type NodeRelation = "main" | "branch" | "focused-inquiry";

interface FocusSelection {
  sourceNodeId: string;
  text: string;
  start?: number;
  end?: number;
  contentHash: string;
}

interface ConversationNode {
  // 既有字段省略
  relation?: NodeRelation;
  inquiryRootId?: string;
  focusSelection?: FocusSelection; // 只在选区追问根用户节点上保存
}
```

追问复用普通 Turn 和 SSE，不另外创建一套模型协议：

```http
POST /api/v1/timelines/timeline_123/turns
Idempotency-Key: inquiry_0199...
Content-Type: application/json
```

```json
{
  "clientMessageId": "node_inquiry_0199",
  "parentNodeId": "node_assistant_123",
  "inquiryRootId": "node_inquiry_root_123",
  "content": "这个专有名词在这里具体指什么？",
  "relation": "focused-inquiry",
  "focusSelection": {
    "sourceNodeId": "node_assistant_123",
    "text": "专有名词",
    "start": 18,
    "end": 22,
    "contentHash": "f0c9d7a1"
  },
  "model": "default"
}
```

响应仍然返回 `turnId`、用户节点、助手占位节点和 `eventsUrl`。用户节点必须立即包含 `relation` 和 `focusSelection`；助手节点包含 `relation: "focused-inquiry"`，但不重复保存选区正文。模型网关在组装上下文时使用以下逻辑：

```text
主时间线历史（排除 focused-inquiry 节点）
  + 原消息选区 FocusSelection.text
  + 当前追问 content
```

服务端校验规则：

- `sourceNodeId` 必须属于当前时间线的可见上下文，首版只允许 `assistant` 节点。
- `text` 长度限制为 1,200 个字符，不能为空；`contentHash` 用于检测消息变化，变化后返回 `INQUIRY_SELECTION_STALE`。
- 根追问的 `parentNodeId` 指向来源消息；根节点的 `inquiryRootId` 等于 `clientMessageId`，后续节点必须携带同一 `inquiryRootId`，且 `parentNodeId` 只能指向同一棵树中的 user/assistant 节点。
- 后续追问只在请求中临时兼容接收 `focusSelection`，服务端会以根节点快照为准；只有根用户节点持久化 `focusSelection`，助手节点和后续用户节点不重复保存。
- `focused-inquiry` 节点不参与普通主线的最新节点、默认模型历史和主线消息列表，但必须出现在图快照中。
- 删除或编辑原消息不能静默改变历史选区；服务端保留 `text` 快照，来源节点只用于定位。

错误码：

| code | HTTP | 含义 |
| --- | --- | --- |
| `INQUIRY_SELECTION_REQUIRED` | 422 | 追问缺少选区对象 |
| `INQUIRY_SOURCE_INVALID` | 422 | 来源节点不存在、不可见或不是助手节点 |
| `INQUIRY_SELECTION_STALE` | 409 | `contentHash` 与来源消息当前版本不一致 |
| `INQUIRY_PARENT_INVALID` | 422 | 追问父节点不属于同一棵聚焦树 |
| `INQUIRY_ROOT_INVALID` | 422 | `inquiryRootId` 与父节点或根节点不匹配 |

SSE 事件属于独立的 `turnId`，每个 `message.delta` 都带单调递增的 `sequence`。服务端按事件 ID 支持 `Last-Event-ID` 重连；客户端断线后应携带最后一个已处理的事件 ID重新读取。主动停止生成使用 `POST /api/v1/turns/:turnId/cancel`，取消和断流都会把助手节点收敛为 `failed`，不会永久保留 `streaming` 状态。

桌面端使用同一内容契约，但不经过 HTTP：React 将 `relation`、`inquiryRootId` 和 `focusSelection` 作为 `complete_message` 的 IPC 输入传给 Rust，Rust ModelGateway 只负责把选区注入上游模型请求；根节点选区和追问根标识由 React 写入 SQLite 工作区快照。云端迁移到 PostgreSQL 时，在 `conversation_nodes` 增加 `relation`、`inquiry_root_id` 和 `focus_selection JSONB`，并为 `inquiry_root_id` 与 `focus_selection->>'sourceNodeId'` 建索引即可，不需要新增追问表。

### 6.4 合并

首版合并不是 Git 式状态合并，而是生成一个 `kind: "merge"` 的摘要节点。原始分支不删除，`sourceNodeIds` 必须完整保留。

## 7. 错误模型

所有非 2xx 响应使用统一结构：

```json
{
  "error": {
    "code": "TIMELINE_FORK_POINT_INVALID",
    "message": "分支点不属于当前对话",
    "requestId": "req_0199...",
    "retryable": false,
    "details": {}
  }
}
```

| HTTP 状态 | 使用场景 |
| --- | --- |
| `400` | JSON 或字段格式错误 |
| `401/403` | 未登录或无资源权限 |
| `404` | 对话、时间线或节点不存在 |
| `409` | 幂等键冲突、版本冲突或非法分支关系 |
| `422` | 字段有效但违反领域规则 |
| `429` | 用户或模型供应商限流 |
| `502/503` | 模型供应商失败或服务暂不可用 |

用户可见文案由前端根据稳定的 `code` 映射。服务端 `message` 只用于诊断，不能依赖它做程序分支。

## 8. 一致性与幂等

- 创建消息、分支、引用、合并和风险都必须支持幂等重放。
- 幂等记录按“用户 + 路由 + Idempotency-Key”保存至少 24 小时。
- 同一个键对应不同请求体时返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 可编辑实体增加 `version` 整数；更新时使用 `If-Match` 或请求体中的 `expectedVersion`。
- 消息和引用默认追加写入，不做原地覆盖。编辑消息时创建修订记录。
- 服务端事务提交后再发布流事件或 Outbox 事件，避免数据库已失败但客户端收到成功。

## 9. 前端适配器实现顺序

1. 将 `WorkspaceProvider` 中的写操作整理为 `WorkspaceFacade` 命令。
2. 修正第 2 节列出的领域端口，给本地实现补齐同一契约。
3. 新建 `HttpConversationService`、`HttpTimelineService`、`HttpThreatService` 和 `HttpReferenceService`。
4. 用运行时配置选择 `local` 或 `remote` 适配器，组件不感知差异。
5. 对乐观消息做服务端确认和失败回滚。
6. 最后再加入账号、令牌刷新和离线同步。

运行时配置建议：

```typescript
interface RuntimeConfig {
  mode: "local" | "remote";
  apiBaseUrl?: string;
  authMode: "disabled" | "oidc";
}
```

构建时只注入公开地址和功能开关，任何服务密钥都不能通过 `VITE_*` 变量打入前端。

## 10. 联调验收清单

- 重复提交相同幂等键不会生成重复节点。
- 流式输出的中文字符不会被错误拆码或重复拼接。
- 中途取消生成后，助手节点进入可恢复状态。
- 从继承节点分支时，服务端上下文与前端地图展示一致。
- 刷新、断网重连或重启 EXE 后，消息和当前图结构可恢复。
- 引用源被编辑后，历史引用快照不改变，并可定位到源修订。
- 风险解决操作存在版本冲突时不会覆盖另一设备的新状态。
- 服务端错误不会把供应商密钥、完整提示词或内部堆栈返回给客户端。
- Web 与 Tauri 使用同一套契约测试通过。
