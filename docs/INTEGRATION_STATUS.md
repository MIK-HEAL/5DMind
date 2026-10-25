# 5DMind 前后端集成状态

> 检查日期：2026-09-29  
> 结论：桌面本地持久化、Provider 凭据、完整上下文、真实 Provider token 流式链路和选区追问本地闭环已接通；云端同步仍待继续。

## 当前真实运行链路

```text
React UI
  -> WorkspaceProvider
  -> 桌面：Tauri command + SQLite；Web：IndexedDB / localStorage
  -> 桌面：Tauri IPC -> Rust ModelGateway -> Provider HTTP；Web：显式连接错误适配器

NestJS API（独立运行，前端未调用）
  -> REST / SSE controllers
  -> WorkspaceStore（进程内存）
  -> 未接入模型时返回 503 错误事件

Tauri
  -> SQLite 工作区仓储 commands
  -> 桌面系统凭据库 / 移动端应用私有 SQLite 凭据 commands
  -> Provider URL/模型目录/对话请求 ModelGateway
```

`seedWorkspace` 已从生产代码删除。首次启动和重置只创建空的本地工作区；
桌面 Provider 未配置或请求失败时写入带错误信息的失败节点。桌面由 Rust ModelGateway 直接读取供应商 SSE/NDJSON，再通过 Tauri IPC Channel 转发 token 事件；当前上下文取当前时间线最近 80 条、最多 120,000 字符的已完成 user/assistant 节点。

## 能力对照

| 能力 | 前端现状 | 后端现状 | 闭环缺口 |
| --- | --- | --- | --- |
| 对话列表/创建 | 本地 snapshot | 已有 list/create/graph 路由 | HTTP adapter、启动 hydration、创建后主线返回契约 |
| 发送消息 | 桌面通过 Tauri IPC Channel 调用 Rust ModelGateway，携带时间线历史；Web 未配置服务时写入失败节点 | turn + SSE 已有，模型未接入时返回 503 | 取消/重连、云端统一上下文组装 |
| 选区追问 | 本地创建 `focused-inquiry` 节点，保存选区文本/哈希，消息旁牌堆和地图聚焦树已接通 | Turn DTO 已接受 `relation` 与 `focusSelection`，SSE 复用普通消息事件；当前仍为内存仓储和 503 模型状态 | PostgreSQL 迁移、选区哈希冲突校验、云端真实模型 |
| 分支/比较/合并 | 本地 reducers | 路由已存在 | Timeline adapter、乐观更新回滚、刷新策略 |
| 跨盘引用 | 本地 reducer | 创建路由已存在 | `ReferenceService`、DTO 映射、远程状态刷新 |
| 风险标记/解决 | 本地 reducer | 路由已存在 | Threat adapter、`version` 并发字段映射 |
| 工作区持久化 | Tauri 桌面/移动端 SQLite command；Web IndexedDB | 进程内存；Drizzle schema 未接管 | PostgreSQL repository、迁移、事务与恢复 |
| Provider/Agent 设置 | Provider 元数据在 localStorage；桌面使用系统凭据库，Android 使用应用私有 SQLite | Tauri commands 按平台选择凭据后端 | 多 Key 轮换、云端同步边界、迁移器 |
| Tauri 离线能力 | SQLite、系统凭据、本地 ModelGateway 和 Provider 原生流式已接入 | 云端仍独立运行 | 重试、取消、迁移器 |
| 账号与多端同步 | 无 | 无 | 认证、设备会话、增量同步和冲突策略 |
| 集成测试 | 前后端各自单测 | store/pipe 单测 | 契约测试、API e2e、Web/Tauri 端到端测试 |

## 文件链路标记

可以使用下面的命令定位所有待完成链路：

```bash
rg -n "TODO\(5dmind-integration\)" src src-tauri apps/api
```

- `src/domain/services.ts`：领域端口和远程 DTO 差异。
- `src/state/WorkspaceProvider.tsx`：前端操作仍由本地 reducers 完成。
- `src/infrastructure/workspaceRepository.ts`：Web IndexedDB 和迁移边界；首次启动不再注入演示数据。
- `src/infrastructure/workspaceFactory.ts`：创建空的初始工作区，不属于业务演示数据。
- `src/infrastructure/tauriWorkspaceRepository.ts`：桌面 SQLite command 适配器。
- `src/infrastructure/unavailableConversationService.ts`：模型未接入时的明确失败状态。
- `src/state/SettingsProvider.tsx`：Provider/Agent/偏好与密钥链路。
- `src/infrastructure/runtime.ts`：按 Web、桌面和显式远程模式选择运行时。
- `src-tauri/src/lib.rs`：SQLite、平台凭据后端、Provider 模型目录和 Rust ModelGateway commands 已接入。
- `apps/api/src/infrastructure/workspace.store.ts`：内存仓储与未接入模型时的 503 失败流。
- `src/features/chat/ChatPanel.tsx`：选区工具条、追问输入和聚焦树交互；首版只允许助手消息选区。
- `src/features/chat/MessageCard.tsx`：来源消息旁的折叠追问牌堆。
- `src/features/map/TimelineGraph.tsx` / `src/features/map/TimelinePanel.tsx`：节点旁追问数量和单树聚焦视图。
- `docs/BACKEND_INTEGRATION.md` 第 6.3 节：选区追问 HTTP、SSE、错误码和落库契约。

## 尚未完成的门槛

只有以下条件同时满足后，才应删除显式连接错误适配器并启用真实模型：

1. HTTP/SSE adapters 覆盖对话、时间线、引用和风险的全部 UI 操作。
2. 应用启动能从服务端恢复完整工作区，并处理空账号、离线和失败状态。
3. 服务端使用持久化 repository，重启后数据不丢失。
4. Model Gateway 已接入真实供应商和原生流式，但仍需取消、错误恢复和重连。
5. Provider/Agent 设置与 API Key 的本地/云端边界已经确定并实现。
6. Web 和 Tauri 的契约测试与端到端主流程测试通过。
