import type { ConversationService, SendMessageInput } from "../domain/services";
import type { ContextSnapshot, Conversation, ConversationNode, MessageEvent, WorkspaceSnapshot } from "../domain/types";
import { getTimeline, getTimelineNodes, isFocusedInquiry } from "../domain/selectors";

// TODO(5dmind-integration): Replace this explicit failure adapter with the local
// Tauri ModelGateway once a real provider, cancellation, and retry policy exist.

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function connectionError(model?: string) {
  return model
    ? {
        status: 503,
        code: "MODEL_GATEWAY_UNAVAILABLE",
        detail: "当前运行时无法连接已选择的模型服务。",
      }
    : {
        status: 400,
        code: "MODEL_NOT_CONFIGURED",
        detail: "当前 Agent 尚未配置可用模型。",
      };
}

export class UnavailableConversationService implements ConversationService {
  constructor(private readonly snapshotRef: { current: WorkspaceSnapshot }) {}

  async createConversation(title: string): Promise<Conversation> {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title,
      summary: "新的对话工作区",
      color: "#206b5a",
      createdAt: now,
      updatedAt: now,
    };
  }

  async renameConversation(conversationId: string, title: string): Promise<Conversation> {
    const conversation = this.snapshotRef.current.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("对话不存在");
    return { ...conversation, title: title.trim(), updatedAt: new Date().toISOString() };
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (!this.snapshotRef.current.conversations.some((item) => item.id === conversationId))
      throw new Error("对话不存在");
  }

  async updateMessage(messageId: string, content: string): Promise<ConversationNode> {
    const node = this.snapshotRef.current.nodes.find((item) => item.id === messageId);
    if (!node) throw new Error("消息不存在");
    const clean = content.trim();
    if (!clean) throw new Error("消息内容不能为空");
    return { ...node, content: clean, summary: clean.replace(/\s+/g, " ").slice(0, 44) };
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.snapshotRef.current.nodes.some((item) => item.id === messageId)) throw new Error("消息不存在");
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<MessageEvent> {
    const { timelineId, model } = input;
    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    const timelineNodes = getTimelineNodes(this.snapshotRef.current, timelineId).filter(
      (node) => !isFocusedInquiry(node),
    );
    const failure = connectionError(model);
    const error = `HTTP ${failure.status} · ${failure.code}: ${failure.detail}`;
    const content = `无法生成回复\n\n${error}\n\n请打开设置 > 模型服务，配置 Provider 和模型后重试。`;

    yield {
      type: "message.started",
      message: {
        id: messageId,
        timelineId,
        parentNodeId: timelineNodes.at(-1)?.id,
        kind: "assistant",
        content,
        summary: "模型服务不可用",
        status: "streaming",
        createdAt: now,
        metadata: { model: model || "未配置模型", author: "连接检查" },
      },
    };

    await sleep(180);
    yield { type: "message.failed", messageId, error };
  }

  async getContext(timelineId: string): Promise<ContextSnapshot> {
    const snapshot = this.snapshotRef.current;
    const timeline = getTimeline(snapshot, timelineId);
    const nodes = getTimelineNodes(snapshot, timelineId).filter((node) => !isFocusedInquiry(node));
    const inheritedNodeCount = nodes.filter((node) => node.timelineId !== timelineId).length;
    return { timeline, nodes, inheritedNodeCount };
  }
}
