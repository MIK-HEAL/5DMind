import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConversationService, ConversationTurn, SendMessageInput } from "../domain/services";
import type { ContextSnapshot, Conversation, ConversationNode, MessageEvent, WorkspaceSnapshot } from "../domain/types";
import { getTimeline, getTimelineNodes, isFocusedInquiry } from "../domain/selectors";

interface CompleteMessageResponse {
  messageId: string;
  timelineId: string;
  parentNodeId?: string;
  relation?: ConversationNode["relation"];
  inquiryRootId?: string;
  focusSelection?: ConversationNode["focusSelection"];
  content: string;
  model: string;
}

interface ProviderStreamEvent {
  event: "started" | "delta" | "completed" | "failed";
  messageId: string;
  model: string;
  relation?: ConversationNode["relation"];
  inquiryRootId?: string;
  focusSelection?: ConversationNode["focusSelection"];
  delta?: string;
  error?: string;
}

class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private waiter?: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void };
  private closed = false;
  private failure?: unknown;

  push(item: T) {
    if (this.closed) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close() {
    this.closed = true;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      if (this.failure) waiter.reject(this.failure);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown) {
    this.failure = error;
    this.close();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
    if (this.closed) {
      return this.failure ? Promise.reject(this.failure) : Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
}

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const MAX_HISTORY_MESSAGES = 80;
const MAX_HISTORY_CHARS = 120_000;

function conversationHistory(snapshot: WorkspaceSnapshot, input: SendMessageInput): ConversationTurn[] {
  const nodes = getTimelineNodes(snapshot, input.timelineId);
  const turns = nodes
    .filter((node) => !isFocusedInquiry(node))
    .filter((node) => (node.kind === "user" || node.kind === "assistant") && node.status === "complete")
    .filter((node) => node.content.trim())
    .map((node) => ({ role: node.kind as "user" | "assistant", content: node.content.trim() }));

  if (input.relation === "focused-inquiry" && input.inquiryRootId && input.parentNodeId) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const inquiryPath: ConversationNode[] = [];
    let current = nodesById.get(input.parentNodeId);
    const visited = new Set<string>();
    while (current && current.id !== input.inquiryRootId && !visited.has(current.id)) {
      visited.add(current.id);
      if (isFocusedInquiry(current)) inquiryPath.unshift(current);
      current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined;
    }
    if (current?.id === input.inquiryRootId) inquiryPath.unshift(current);
    turns.push(...inquiryPath
      .filter((node) => (node.kind === "user" || node.kind === "assistant") && node.status === "complete")
      .filter((node) => node.content.trim())
      .map((node) => ({ role: node.kind as "user" | "assistant", content: node.content.trim() })));
  }

  const selected: ConversationTurn[] = [];
  let characters = 0;
  for (const turn of turns.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    const nextCharacters = characters + turn.content.length;
    if (selected.length > 0 && nextCharacters > MAX_HISTORY_CHARS) break;
    selected.push(turn);
    characters = nextCharacters;
  }
  return selected.reverse();
}

/** Desktop conversation adapter: IPC to the Rust local ModelGateway, then local event shaping. */
export class TauriConversationService implements ConversationService {
  constructor(private readonly getSnapshot: () => WorkspaceSnapshot) {}

  async createConversation(title: string): Promise<Conversation> {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title,
      summary: "新的本地工作区",
      color: "#206b5a",
      createdAt: now,
      updatedAt: now,
    };
  }

  async renameConversation(conversationId: string, title: string): Promise<Conversation> {
    const conversation = this.getSnapshot().conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("对话不存在");
    return { ...conversation, title: title.trim(), updatedAt: new Date().toISOString() };
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.getSnapshot().conversations.some((item) => item.id === conversationId)) throw new Error("对话不存在");
  }

  async updateMessage(messageId: string, content: string): Promise<ConversationNode> {
    const node = this.getSnapshot().nodes.find((item) => item.id === messageId);
    if (!node) throw new Error("消息不存在");
    const clean = content.trim();
    if (!clean) throw new Error("消息内容不能为空");
    return { ...node, content: clean, summary: clean.replace(/\s+/g, " ").slice(0, 44) };
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.getSnapshot().nodes.some((item) => item.id === messageId)) throw new Error("消息不存在");
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<MessageEvent> {
    if (input.signal?.aborted) throw new DOMException("消息请求已取消", "AbortError");
    const history = conversationHistory(this.getSnapshot(), input);
    const queue = new AsyncEventQueue<ProviderStreamEvent>();
    const channel = new Channel<ProviderStreamEvent>((event) => queue.push(event));
    const invocation = invoke<CompleteMessageResponse>("complete_message", {
      input: {
        timelineId: input.timelineId,
        content: input.content,
        parentNodeId: input.parentNodeId,
        inquiryRootId: input.inquiryRootId,
        relation: input.relation,
        focusSelection: input.focusSelection,
        model: input.model,
        providerId: input.providerId,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        apiPath: input.apiPath,
        requestTimeoutMs: input.requestTimeoutMs,
        instructions: input.instructions,
        temperature: input.temperature,
        reasoningEffort: input.reasoningEffort,
        webSearch: input.webSearch,
        history,
      },
      onEvent: channel,
    }).then((response) => { queue.close(); return response; }).catch((error) => {
      queue.fail(error);
      throw error;
    });

    let receivedEvent = false;
    let failedEvent = false;
    try {
      while (true) {
        const next = await queue.next();
        if (next.done) break;
        receivedEvent = true;
        const event = next.value;
        if (input.signal?.aborted) throw new DOMException("消息请求已取消", "AbortError");
        if (event.event === "started") {
          const message: ConversationNode = {
            id: event.messageId,
            timelineId: input.timelineId,
            parentNodeId: input.parentNodeId,
            relation: event.relation ?? input.relation,
            inquiryRootId: event.inquiryRootId ?? input.inquiryRootId,
            kind: "assistant",
            content: "",
            summary: "正在生成桌面回复",
            status: "streaming",
            createdAt: new Date().toISOString(),
            metadata: { model: event.model },
          };
          yield { type: "message.started", message };
        } else if (event.event === "delta" && event.delta) {
          yield { type: "message.delta", messageId: event.messageId, delta: event.delta };
        } else if (event.event === "completed") {
          yield { type: "message.completed", messageId: event.messageId };
        } else if (event.event === "failed") {
          failedEvent = true;
          yield { type: "message.failed", messageId: event.messageId, error: event.error ?? "Provider 流式请求失败" };
        }
      }
      const response = await invocation.catch((error) => {
        if (failedEvent) return undefined;
        throw error;
      });
      if (failedEvent || !response) return;
      if (!receivedEvent) {
        const now = new Date().toISOString();
        yield {
          type: "message.started",
          message: {
            id: response.messageId,
            timelineId: response.timelineId,
            parentNodeId: response.parentNodeId ?? input.parentNodeId,
            relation: response.relation ?? input.relation,
            inquiryRootId: response.inquiryRootId ?? input.inquiryRootId,
            kind: "assistant",
            content: "",
            summary: "正在生成桌面回复",
            status: "streaming",
            createdAt: now,
            metadata: { model: response.model },
          },
        };
        const chunks = response.content.match(/.{1,8}/gs) ?? [response.content];
        for (const delta of chunks) {
          if (input.signal?.aborted) throw new DOMException("消息请求已取消", "AbortError");
          await sleep(18);
          yield { type: "message.delta", messageId: response.messageId, delta };
        }
        yield { type: "message.completed", messageId: response.messageId };
      }
    } catch (error) {
      await invocation.catch(() => undefined);
      if (failedEvent) return;
      throw error;
    }
  }

  async getContext(timelineId: string): Promise<ContextSnapshot> {
    const snapshot = this.getSnapshot();
    const timeline = getTimeline(snapshot, timelineId);
    const nodes = getTimelineNodes(snapshot, timelineId).filter((node) => !isFocusedInquiry(node));
    return {
      timeline,
      nodes,
      inheritedNodeCount: nodes.filter((node) => node.timelineId !== timeline.id).length,
    };
  }
}
