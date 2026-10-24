import type {
  ConversationService,
  ReferenceService,
  SendMessageInput,
  ThreatService,
  TimelineService,
} from "../domain/services";
import type {
  ContextSnapshot,
  Conversation,
  ConversationNode,
  GraphSnapshot,
  MessageEvent,
  Threat,
  Timeline,
  TimelineComparison,
  WorkspaceSnapshot,
} from "../domain/types";
import { apiBaseUrl } from "./runtime";

interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string; retryable?: boolean };
}

export class RemoteApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;

  constructor(status: number, body?: ApiErrorBody) {
    super(body?.error?.message ?? `请求失败（HTTP ${status}）`);
    this.name = "RemoteApiError";
    this.status = status;
    this.code = body?.error?.code;
    this.requestId = body?.error?.requestId;
    this.retryable = body?.error?.retryable;
  }
}

type SseRecord = { id?: string; event?: string; data: string[] };

function idempotencyKey() {
  return crypto.randomUUID();
}

function makeSnapshot(graphs: GraphSnapshot[]): WorkspaceSnapshot {
  const conversations = graphs.map((graph) => graph.conversation);
  const timelines = graphs.flatMap((graph) => graph.timelines);
  const nodes = graphs.flatMap((graph) => graph.nodes);
  const threats = graphs.flatMap((graph) => graph.threats);
  const references = [...new Map(graphs.flatMap((graph) => graph.references).map((item) => [item.id, item])).values()];
  const currentConversation = conversations[0];
  const currentTimeline = timelines.find((timeline) => timeline.conversationId === currentConversation?.id && timeline.status === "active") ?? timelines[0];
  if (!currentConversation || !currentTimeline) throw new Error("服务端没有可用的工作区时间线");
  return {
    version: 1,
    conversations,
    timelines,
    nodes,
    threats,
    references,
    currentConversationId: currentConversation.id,
    currentTimelineId: currentTimeline.id,
  };
}

export class HttpWorkspaceService implements ConversationService, TimelineService, ThreatService, ReferenceService {
  constructor(private readonly baseUrl = apiBaseUrl) {}

  async hydrate(): Promise<WorkspaceSnapshot> {
    let conversations = await this.listConversations();
    if (!conversations.length) {
      conversations = [await this.createConversation("新的云端工作区")];
    }
    const graphs = await Promise.all(conversations.map((conversation) => this.getGraph(conversation.id)));
    return makeSnapshot(graphs);
  }

  async listConversations(): Promise<Conversation[]> {
    const response = await this.request<{ conversations: Conversation[] }>("/conversations");
    return response.conversations;
  }

  async getGraph(conversationId: string): Promise<GraphSnapshot> {
    return this.request<GraphSnapshot>(`/conversations/${encodeURIComponent(conversationId)}/graph`);
  }

  async createConversation(title: string): Promise<Conversation> {
    return this.request<Conversation>("/conversations", {
      method: "POST",
      body: { title },
      idempotent: true,
    });
  }

  async renameConversation(conversationId: string, title: string): Promise<Conversation> {
    return this.request<Conversation>(`/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: { title },
      idempotent: true,
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.request<void>(`/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
      idempotent: true,
    });
  }

  async updateMessage(messageId: string, content: string): Promise<ConversationNode> {
    return this.request<ConversationNode>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { content },
      idempotent: true,
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.request<void>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      idempotent: true,
    });
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<MessageEvent> {
    const response = await this.request<{
      turnId: string;
      userMessage: ConversationNode;
      assistantMessage: ConversationNode;
      eventsUrl: string;
    }>(`/timelines/${encodeURIComponent(input.timelineId)}/turns`, {
      method: "POST",
      body: {
        content: input.content,
        clientMessageId: input.clientMessageId,
        parentNodeId: input.parentNodeId,
        inquiryRootId: input.inquiryRootId,
        model: input.model,
        relation: input.relation,
        focusSelection: input.focusSelection,
      },
      idempotent: true,
      signal: input.signal,
    });

    yield* this.readEvents(response.eventsUrl, input.signal);
  }

  async getContext(timelineId: string): Promise<ContextSnapshot> {
    return this.request<ContextSnapshot>(`/timelines/${encodeURIComponent(timelineId)}/context`);
  }

  async forkFromMessage(messageId: string, name?: string, contextMode: Timeline["contextMode"] = "until-node"): Promise<Timeline> {
    return this.request<Timeline>(`/messages/${encodeURIComponent(messageId)}/forks`, {
      method: "POST",
      body: { name, contextMode },
      idempotent: true,
    });
  }

  async switchTimeline(_timelineId: string): Promise<void> {
    return Promise.resolve();
  }

  async compareTimelines(ids: string[]): Promise<TimelineComparison> {
    return this.request<TimelineComparison>("/timeline-comparisons", {
      method: "POST",
      body: { timelineIds: ids },
    });
  }

  async mergeSummary(sourceIds: string[], targetId: string): Promise<ConversationNode> {
    return this.request<ConversationNode>(`/timelines/${encodeURIComponent(targetId)}/merge-summaries`, {
      method: "POST",
      body: { sourceIds },
      idempotent: true,
    });
  }

  async createReference(input: { sourceNodeId: string; targetTimelineId: string; label?: string }) {
    return this.request<{ node: ConversationNode; link: WorkspaceSnapshot["references"][number] }>("/references", {
      method: "POST",
      body: input,
      idempotent: true,
    });
  }

  async createThreat(input: Parameters<ThreatService["createThreat"]>[0]): Promise<Threat> {
    return this.request<Threat>("/threats", { method: "POST", body: input, idempotent: true });
  }

  async resolveThreat(threatId: string, resolution: string, expectedVersion?: number): Promise<Threat> {
    return this.request<Threat>(`/threats/${encodeURIComponent(threatId)}/resolve`, {
      method: "PATCH",
      body: { resolution, expectedVersion },
      idempotent: true,
    });
  }

  private async request<T>(path: string, options: {
    method?: string;
    body?: unknown;
    idempotent?: boolean;
    signal?: AbortSignal;
  } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotent) headers["Idempotency-Key"] = idempotencyKey();
    const response = await fetch(this.url(path), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    if (!response.ok) throw new RemoteApiError(response.status, await this.readError(response));
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async *readEvents(path: string, signal?: AbortSignal): AsyncIterable<MessageEvent> {
    let lastEventId: string | undefined;
    let attempts = 0;
    let terminal = false;
    while (!terminal) {
      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        };
        if (lastEventId) headers["Last-Event-ID"] = lastEventId;
        const response = await fetch(this.url(path), { headers, signal });
        if (!response.ok) throw new RemoteApiError(response.status, await this.readError(response));
        if (!response.body) throw new Error("服务端没有返回 SSE 流");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let record: SseRecord = { data: [] };
        const emit = (item: SseRecord): MessageEvent | undefined => {
          if (item.id) lastEventId = item.id;
          if (!item.event || !item.data.length) return undefined;
          const payload = JSON.parse(item.data.join("\n")) as Record<string, unknown>;
          if (item.event === "message.started") return { type: "message.started", message: payload.message as ConversationNode };
          if (item.event === "message.delta") {
            const reasoning = payload.reasoning ?? payload.reasoningContent ?? payload.reasoning_content;
            if (typeof reasoning === "string" && reasoning) return { type: "message.reasoning_delta", messageId: String(payload.messageId), delta: reasoning };
            return { type: "message.delta", messageId: String(payload.messageId), delta: String(payload.delta ?? "") };
          }
          if (item.event === "message.reasoning_delta") return { type: "message.reasoning_delta", messageId: String(payload.messageId), delta: String(payload.delta ?? "") };
          if (item.event === "message.completed") {
            terminal = true;
            return { type: "message.completed", messageId: String(payload.messageId) };
          }
          if (item.event === "message.failed") {
            terminal = true;
            return { type: "message.failed", messageId: String(payload.messageId), error: String(payload.error ?? "生成失败") };
          }
          return undefined;
        };
        const process = (line: string): MessageEvent | undefined => {
          if (line === "") {
            const event = emit(record);
            record = { data: [] };
            return event;
          }
          if (line.startsWith("id:")) record.id = line.slice(3).trim();
          else if (line.startsWith("event:")) record.event = line.slice(6).trim();
          else if (line.startsWith("data:")) record.data.push(line.slice(5).trimStart());
          return undefined;
        };
        while (true) {
          const result = await reader.read();
          buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = process(line);
            if (event) yield event;
          }
          if (result.done) break;
        }
        if (buffer) {
          const event = process(buffer);
          if (event) yield event;
        }
        const event = emit(record);
        if (event) yield event;
        if (terminal) return;
      } catch (error) {
        if (signal?.aborted || error instanceof RemoteApiError) throw error;
        if (attempts >= 2) throw error;
      }
      attempts += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 200 * attempts));
    }
  }

  private url(path: string) {
    if (/^https?:\/\//.test(path)) return path;
    if (path.startsWith("/api/v1/")) return `${this.baseUrl.replace(/\/$/, "")}${path}`;
    return `${this.baseUrl.replace(/\/$/, "")}/api/v1/${path.replace(/^\//, "")}`;
  }

  private async readError(response: Response): Promise<ApiErrorBody | undefined> {
    try { return await response.json() as ApiErrorBody; } catch { return undefined; }
  }
}
