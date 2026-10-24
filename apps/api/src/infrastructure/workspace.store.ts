import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  Conversation,
  ConversationNode,
  ContextMode,
  FocusSelection,
  GraphSnapshot,
  NodeRelation,
  ReferenceLink,
  Threat,
  ThreatSeverity,
  TurnContext,
  TurnContextMessage,
  Timeline,
  TurnEvent,
  TurnRecord,
  MessageAttachment,
} from "./store.types.js";

const colors = ["#206b5a", "#ce6d39", "#4b67b0", "#7a5ba6"];
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MODEL_GATEWAY_FAILURE = "HTTP 503 · MODEL_GATEWAY_UNAVAILABLE: 当前云端模型服务尚未配置";
const STREAM_DISCONNECTED_FAILURE = "SSE 连接中断，生成已失败，请重试";

// Keep this hash compatible with the desktop/web selection snapshot. It is a
// small content version marker, not a security digest.
function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

type TurnInput = {
  content: string;
  clientMessageId: string;
  replaceMessageId?: string;
  parentNodeId?: string;
  inquiryRootId?: string;
  model?: string;
  relation?: NodeRelation;
  focusSelection?: FocusSelection;
  attachments?: MessageAttachment[];
};

interface InquiryResolution {
  rootId: string;
  parentNodeId: string;
  focusSelection: FocusSelection;
  isRoot: boolean;
}

// TODO(5dmind-integration): 这是进程内联调仓储，重启即丢失数据；模型网关尚未接入。
// 生产闭环需要将领域操作迁移到 Drizzle/PostgreSQL repository，并把当前
// TurnContext 接到真实 Model Gateway，同时持久化 turn_events 和终态。

interface IdempotencyRecord {
  fingerprint: string;
  result: unknown;
}

@Injectable()
export class WorkspaceStore {
  private version = 0;
  private readonly conversations = new Map<string, Conversation>();
  private readonly timelines = new Map<string, Timeline>();
  private readonly nodes = new Map<string, ConversationNode>();
  private readonly threats = new Map<string, Threat>();
  private readonly references = new Map<string, ReferenceLink>();
  private readonly turns = new Map<string, TurnRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  listConversations(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createConversation(title: string, idempotencyKey?: string): Conversation {
    return this.idempotent("POST /conversations", idempotencyKey, { title }, () => {
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: this.id("conversation"), title, summary: "新的云端工作区",
        color: colors[this.conversations.size % colors.length], createdAt: now, updatedAt: now,
      };
      this.conversations.set(conversation.id, conversation);
      const timeline: Timeline = {
        id: this.id("timeline"), conversationId: conversation.id, name: "主线",
        contextMode: "until-node", status: "active", color: conversation.color,
        createdAt: now, updatedAt: now,
      };
      this.timelines.set(timeline.id, timeline);
      this.bump();
      return conversation;
    });
  }

  renameConversation(conversationId: string, title: string, idempotencyKey?: string): Conversation {
    return this.idempotent("PATCH /conversations", idempotencyKey, { conversationId, title }, () => {
      const conversation = this.getConversation(conversationId);
      const updated = { ...conversation, title, updatedAt: new Date().toISOString() };
      this.conversations.set(conversationId, updated);
      this.bump();
      return updated;
    });
  }

  deleteConversation(conversationId: string, idempotencyKey?: string): void {
    this.idempotent("DELETE /conversations", idempotencyKey, { conversationId }, () => {
      this.getConversation(conversationId);
      if (this.conversations.size <= 1) {
        throw new ConflictException({ error: { code: "LAST_CONVERSATION", message: "至少需要保留一个对话" } });
      }
      const timelineIds = new Set([...this.timelines.values()]
        .filter((timeline) => timeline.conversationId === conversationId)
        .map((timeline) => timeline.id));
      const nodeIds = new Set([...this.nodes.values()]
        .filter((node) => timelineIds.has(node.timelineId))
        .map((node) => node.id));
      for (const [id, timeline] of this.timelines) if (timelineIds.has(id)) this.timelines.delete(id);
      for (const [id, node] of this.nodes) if (nodeIds.has(id)) this.nodes.delete(id);
      for (const [id, threat] of this.threats) if (threat.conversationId === conversationId) this.threats.delete(id);
      for (const [id, reference] of this.references) {
        if (nodeIds.has(reference.sourceNodeId) || nodeIds.has(reference.targetNodeId)) this.references.delete(id);
      }
      for (const [id, turn] of this.turns) if (timelineIds.has(turn.timelineId)) this.turns.delete(id);
      this.conversations.delete(conversationId);
      this.bump();
    });
  }

  updateMessage(messageId: string, content: string, idempotencyKey?: string): ConversationNode {
    return this.idempotent("PATCH /messages", idempotencyKey, { messageId, content }, () => {
      const node = this.getNode(messageId);
      if (node.kind !== "user" && node.kind !== "assistant") {
        throw new UnprocessableEntityException({ error: { code: "MESSAGE_NOT_EDITABLE", message: "该消息类型不支持编辑" } });
      }
      if (node.status === "streaming") {
        throw new ConflictException({ error: { code: "MESSAGE_STREAMING", message: "消息生成中，暂不能编辑" } });
      }
      const clean = content.trim();
      if (!clean) throw new UnprocessableEntityException({ error: { code: "MESSAGE_EMPTY", message: "消息内容不能为空" } });
      const updated = { ...node, content: clean, summary: this.summary(clean) };
      this.nodes.set(messageId, updated);
      this.bump();
      return updated;
    });
  }

  deleteMessage(messageId: string, idempotencyKey?: string): void {
    this.idempotent("DELETE /messages", idempotencyKey, { messageId }, () => {
      const root = this.getNode(messageId);
      const nodeIds = new Set([root.id]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const node of this.nodes.values()) {
          if (node.timelineId === root.timelineId && node.parentNodeId && nodeIds.has(node.parentNodeId) && !nodeIds.has(node.id)) {
            nodeIds.add(node.id);
            expanded = true;
          }
        }
      }
      for (const id of nodeIds) this.nodes.delete(id);
      for (const [id, threat] of this.threats) if (nodeIds.has(threat.nodeId)) this.threats.delete(id);
      for (const [id, reference] of this.references) {
        if (nodeIds.has(reference.sourceNodeId) || nodeIds.has(reference.targetNodeId)) this.references.delete(id);
      }
      for (const [id, turn] of this.turns) {
        if (nodeIds.has(turn.userMessage.id) || nodeIds.has(turn.assistantMessage.id)) this.turns.delete(id);
      }
      this.bump();
    });
  }

  getGraph(conversationId: string): GraphSnapshot {
    const conversation = this.getConversation(conversationId);
    const timelines = [...this.timelines.values()].filter((timeline) => timeline.conversationId === conversation.id);
    const timelineIds = new Set(timelines.map((timeline) => timeline.id));
    return {
      version: this.version,
      conversation,
      timelines,
      nodes: [...this.nodes.values()].filter((node) => timelineIds.has(node.timelineId)),
      threats: [...this.threats.values()].filter((threat) => threat.conversationId === conversation.id),
      references: [...this.references.values()].filter((reference) => {
        const target = this.nodes.get(reference.targetNodeId);
        return target ? timelineIds.has(target.timelineId) : false;
      }),
      serverTime: new Date().toISOString(),
    };
  }

  getContext(timelineId: string) {
    const timeline = this.getTimeline(timelineId);
    const nodes = this.primaryVisibleNodes(timeline.id);
    return { timeline, nodes, inheritedNodeCount: nodes.filter((node) => node.timelineId !== timeline.id).length };
  }

  createTurn(
    timelineId: string,
    input: TurnInput,
    idempotencyKey?: string,
  ) {
    return this.idempotent("POST /turns", idempotencyKey, { timelineId, ...input }, () => {
      const timeline = this.getTimeline(timelineId);
      const relation = input.relation ?? (input.focusSelection ? "focused-inquiry" : "main");
      if (relation !== "focused-inquiry" && (input.focusSelection || input.inquiryRootId)) {
        throw this.inquiryError("INQUIRY_ROOT_INVALID", "普通消息不能携带追问树字段");
      }
      const inquiry = relation === "focused-inquiry"
        ? this.resolveInquiry(timeline.id, input)
        : undefined;
      const normalizedSelection = inquiry?.focusSelection;
      const normalizedRootId = inquiry?.rootId;
      const normalizedParentId = inquiry?.parentNodeId ?? input.parentNodeId;
      const requestFingerprint = this.turnFingerprint(timelineId, input, relation, normalizedRootId, normalizedParentId, normalizedSelection);
      const existing = this.nodes.get(input.clientMessageId);
      if (existing) {
        const existingTurn = [...this.turns.values()].find((turn) => turn.userMessage.id === existing.id);
        if (!existingTurn || existingTurn.requestFingerprint !== requestFingerprint) {
          throw new ConflictException({ error: { code: "CLIENT_MESSAGE_ID_REUSED", message: "clientMessageId 已被其他消息使用" } });
        }
        return this.turnResponse(existingTurn);
      }
      const now = new Date().toISOString();
      const parentNodeId = normalizedParentId ?? (relation === "focused-inquiry"
        ? normalizedSelection?.sourceNodeId
        : this.primaryVisibleNodes(timeline.id).at(-1)?.id);
      if (parentNodeId && !this.visibleNodes(timeline.id).some((node) => node.id === parentNodeId)) {
        throw new UnprocessableEntityException({ error: { code: "PARENT_NODE_INVALID", message: "父节点不属于当前时间线的可见上下文" } });
      }
      if (relation !== "focused-inquiry" && parentNodeId && this.nodes.get(parentNodeId)?.relation === "focused-inquiry") {
        throw new UnprocessableEntityException({ error: { code: "PARENT_NODE_INVALID", message: "主线消息不能挂在选区追问树上" } });
      }
      if (relation === "focused-inquiry" && (!parentNodeId || !normalizedSelection || !normalizedRootId)) {
        throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问缺少有效的同树父节点");
      }
      const replacement = input.replaceMessageId ? this.nodes.get(input.replaceMessageId) : undefined;
      if (input.replaceMessageId && (!replacement || replacement.timelineId !== timelineId || replacement.kind !== "user")) {
        throw new UnprocessableEntityException({ error: { code: "MESSAGE_REPLACEMENT_INVALID", message: "待替换消息不属于当前时间线或不是用户消息" } });
      }
      const previousTurn = replacement
        ? [...this.turns.values()].find((turn) => turn.userMessage.id === replacement.id)
        : undefined;
      const effectiveAttachments = input.attachments ?? previousTurn?.context.attachments;
      const userMessage: ConversationNode = {
        id: replacement?.id ?? input.clientMessageId, timelineId, parentNodeId, kind: "user", content: input.content,
        summary: this.summary(input.content), relation,
        ...(normalizedRootId ? { inquiryRootId: normalizedRootId } : {}),
        ...(inquiry?.isRoot && normalizedSelection ? { focusSelection: normalizedSelection } : {}),
        status: "complete", createdAt: now, metadata: {
          author: "你",
          tags: relation === "focused-inquiry" ? ["选区追问"] : undefined,
          ...(effectiveAttachments?.length ? { attachments: effectiveAttachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })) } : {}),
        },
      };
      const assistantMessage: ConversationNode = {
        id: this.id("node"), timelineId, parentNodeId: userMessage.id, kind: "assistant", content: "",
        relation, summary: relation === "focused-inquiry" ? "追问回复" : "模型服务不可用", status: "pending", createdAt: now,
        ...(normalizedRootId ? { inquiryRootId: normalizedRootId } : {}),
        metadata: { model: input.model ?? "未配置模型", tags: relation === "focused-inquiry" ? ["选区追问"] : undefined },
      };
      const responseText = `无法生成回复\n\n${MODEL_GATEWAY_FAILURE}。\n\n请配置可用的模型 Provider 后重试。`;
      const context = this.buildTurnContext(
        timeline.id,
        relation,
        normalizedRootId,
        parentNodeId,
        input.content,
        userMessage.id,
        normalizedSelection,
        effectiveAttachments,
      );
      const turn: TurnRecord = {
        id: this.id("turn"), timelineId, userMessage, assistantMessage, responseText,
        model: input.model ?? "未配置模型", events: [], status: "pending", requestFingerprint, context,
        appliedEventIds: new Set(), activeReaders: 0,
      };
      this.nodes.set(userMessage.id, userMessage);
      this.nodes.set(assistantMessage.id, assistantMessage);
      this.turns.set(turn.id, turn);
      this.bump();
      return this.turnResponse(turn);
    });
  }

  async *readTurnEvents(turnId: string, afterId = 0): AsyncGenerator<TurnEvent> {
    const turn = this.turns.get(turnId);
    if (!turn) throw new NotFoundException({ error: { code: "TURN_NOT_FOUND", message: "生成任务不存在" } });
    this.clearFinalizationTimer(turn);
    turn.activeReaders += 1;
    this.ensureTurnEvents(turn);
    let terminalDelivered = turn.status === "complete" || turn.status === "failed";
    try {
      for (const event of turn.events.filter((item) => item.id > afterId)) {
        await wait(event.event === "message.delta" ? 90 : 20);
        this.applyTurnEvent(turn, event);
        terminalDelivered = terminalDelivered || event.event === "message.completed" || event.event === "message.failed";
        yield event;
      }
    } finally {
      turn.activeReaders = Math.max(0, turn.activeReaders - 1);
      if (!terminalDelivered && turn.status !== "complete" && turn.status !== "failed") {
        this.scheduleDisconnectedTurnFailure(turn);
      }
    }
  }

  cancelTurn(turnId: string) {
    const turn = this.turns.get(turnId);
    if (!turn) throw new NotFoundException({ error: { code: "TURN_NOT_FOUND", message: "生成任务不存在" } });
    if (turn.status !== "complete" && turn.status !== "failed") {
      this.clearFinalizationTimer(turn);
      this.ensureTurnEvents(turn, "TURN_CANCELLED: 已取消模型生成");
      this.failTurn(turn, "TURN_CANCELLED: 已取消模型生成");
    }
    return { turnId: turn.id, status: turn.status, assistantMessage: turn.assistantMessage };
  }

  getTurnContext(turnId: string): TurnContext {
    const turn = this.turns.get(turnId);
    if (!turn) throw new NotFoundException({ error: { code: "TURN_NOT_FOUND", message: "生成任务不存在" } });
    return structuredClone(turn.context);
  }

  readTurnAttachment(turnId: string, attachmentId: string, offset = 0, limit = 12_000) {
    const turn = this.turns.get(turnId);
    if (!turn) throw new NotFoundException({ error: { code: "TURN_NOT_FOUND", message: "生成任务不存在" } });
    const attachment = turn.context.attachments?.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException({ error: { code: "ATTACHMENT_NOT_FOUND", message: "附件不属于当前请求" } });
    if (!attachment.textContent) {
      return { id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, text: "该附件没有可读取的文本摘录。" };
    }
    const start = Math.max(0, Math.min(offset, attachment.textContent.length));
    const text = attachment.textContent.slice(start, start + Math.max(1, Math.min(limit, 12_000)));
    return {
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      text,
      ...(start + text.length < attachment.textContent.length ? { nextOffset: start + text.length } : {}),
    };
  }

  private resolveInquiry(timelineId: string, input: TurnInput): InquiryResolution {
    const parent = input.parentNodeId ? this.nodes.get(input.parentNodeId) : undefined;
    if (input.parentNodeId && (!parent || parent.timelineId !== timelineId)) {
      throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问父节点不属于当前时间线");
    }

    if (parent?.relation === "focused-inquiry") {
      const root = this.findInquiryRoot(timelineId, parent.id);
      const selection = root.focusSelection;
      if (!selection) throw this.inquiryError("INQUIRY_ROOT_INVALID", "追问根节点缺少选区快照");
      this.validateInquirySelection(timelineId, selection);
      if (input.inquiryRootId && input.inquiryRootId !== root.id) {
        throw this.inquiryError("INQUIRY_ROOT_INVALID", "追问父节点不属于指定的追问根");
      }
      if (input.focusSelection && !this.sameSelection(input.focusSelection, selection)) {
        throw this.inquiryError("INQUIRY_SELECTION_STALE", "继续追问携带的选区快照已过期");
      }
      return { rootId: root.id, parentNodeId: parent.id, focusSelection: selection, isRoot: false };
    }

    const selection = input.focusSelection;
    if (!selection) throw this.inquiryError("INQUIRY_SELECTION_REQUIRED", "选区追问必须提供来源选区");
    if (input.inquiryRootId && input.inquiryRootId !== input.clientMessageId) {
      throw this.inquiryError("INQUIRY_ROOT_INVALID", "根追问的 inquiryRootId 必须等于 clientMessageId");
    }
    this.validateInquirySelection(timelineId, selection);
    if (parent && parent.id !== selection.sourceNodeId) {
      throw this.inquiryError("INQUIRY_PARENT_INVALID", "根追问的父节点必须是选区来源助手消息");
    }
    return {
      rootId: input.clientMessageId,
      parentNodeId: selection.sourceNodeId,
      focusSelection: selection,
      isRoot: true,
    };
  }

  private findInquiryRoot(timelineId: string, nodeId: string): ConversationNode {
    let current = this.nodes.get(nodeId);
    const visited = new Set<string>();
    while (current?.relation === "focused-inquiry") {
      if (visited.has(current.id)) throw this.inquiryError("INQUIRY_ROOT_INVALID", "追问树存在循环父节点");
      visited.add(current.id);
      if (current.timelineId !== timelineId) throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问节点不属于当前时间线");
      const parentId = current.parentNodeId;
      const parent = parentId ? this.nodes.get(parentId) : undefined;
      if (!parent || parent.timelineId !== timelineId) {
        throw this.inquiryError("INQUIRY_ROOT_INVALID", "追问根节点缺少同一时间线的来源消息");
      }
      if (parent.relation !== "focused-inquiry") {
        if (parent.kind !== "assistant" || current.kind !== "user" || current.focusSelection?.sourceNodeId !== parent.id) {
          throw this.inquiryError("INQUIRY_ROOT_INVALID", "追问根节点的来源关系无效");
        }
        return current;
      }
      current = parent;
    }
    throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问父节点不在聚焦追问树中");
  }

  private validateInquirySelection(timelineId: string, selection: FocusSelection): void {
    const source = this.nodes.get(selection.sourceNodeId);
    if (!source || source.timelineId !== timelineId || source.kind !== "assistant" || !this.visibleNodes(timelineId).some((node) => node.id === source.id)) {
      throw this.inquiryError("INQUIRY_SOURCE_INVALID", "选区来源必须是当前时间线的助手消息");
    }
    if (selection.start !== undefined && selection.end !== undefined && selection.start > selection.end) {
      throw this.inquiryError("INQUIRY_SELECTION_STALE", "选区起止位置无效");
    }
    if (contentHash(source.content) !== selection.contentHash || (source.content.length > 0 && !source.content.includes(selection.text))) {
      throw this.inquiryError("INQUIRY_SELECTION_STALE", "来源助手消息已变化，选区快照已过期");
    }
  }

  private sameSelection(left: FocusSelection, right: FocusSelection): boolean {
    return left.sourceNodeId === right.sourceNodeId
      && left.text === right.text
      && left.start === right.start
      && left.end === right.end
      && left.contentHash === right.contentHash;
  }

  private inquiryPath(timelineId: string, rootId: string, parentNodeId: string): ConversationNode[] {
    const path: ConversationNode[] = [];
    let current = this.nodes.get(parentNodeId);
    const visited = new Set<string>();
    while (current && current.id !== rootId) {
      if (visited.has(current.id) || current.timelineId !== timelineId || current.relation !== "focused-inquiry") {
        throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问父节点不在指定追问树中");
      }
      visited.add(current.id);
      path.unshift(current);
      current = current.parentNodeId ? this.nodes.get(current.parentNodeId) : undefined;
    }
    if (!current || current.id !== rootId) {
      throw this.inquiryError("INQUIRY_PARENT_INVALID", "追问父节点不在指定追问树中");
    }
    path.unshift(current);
    return path;
  }

  private buildTurnContext(
    timelineId: string,
    relation: NodeRelation,
    inquiryRootId: string | undefined,
    parentNodeId: string | undefined,
    question: string,
    questionNodeId: string,
    selection: FocusSelection | undefined,
    attachments: MessageAttachment[] | undefined,
  ): TurnContext {
    const messages: TurnContextMessage[] = this.primaryVisibleNodes(timelineId)
      .filter((node) => (node.kind === "user" || node.kind === "assistant") && node.status === "complete" && node.content.trim())
      .map((node) => ({ role: node.kind === "user" ? "user" : "assistant" as const, content: node.content, nodeId: node.id }));
    if (relation === "focused-inquiry" && inquiryRootId && parentNodeId && selection) {
      messages.push({
        role: "system",
        nodeId: selection.sourceNodeId,
        content: `选区快照（来源 ${selection.sourceNodeId}，内容哈希 ${selection.contentHash}）：\n${selection.text}`,
      });
      if (parentNodeId !== selection.sourceNodeId) {
        for (const node of this.inquiryPath(timelineId, inquiryRootId, parentNodeId)) {
          if ((node.kind === "user" || node.kind === "assistant") && node.content.trim()) {
            messages.push({ role: node.kind, content: node.content, nodeId: node.id });
          }
        }
      }
    }
    const attachmentPrompt = attachments?.length
      ? `\n\n本轮附件（仅允许通过附件句柄读取）：\n${attachments.map((file) => `- ${file.name} [${file.mimeType}] (${file.size} bytes)`).join("\n")}`
      : "";
    messages.push({ role: "user", content: `${question}${attachmentPrompt}`, nodeId: questionNodeId });
    const safeAttachments = attachments?.map(({ id, name, mimeType, size, textContent }) => ({ id, name, mimeType, size, textContent }));
    return { timelineId, relation, inquiryRootId, parentNodeId, messages, ...(selection ? { focusSelection: selection } : {}), ...(safeAttachments?.length ? { attachments: safeAttachments } : {}) };
  }

  private turnFingerprint(
    timelineId: string,
    input: TurnInput,
    relation: NodeRelation,
    inquiryRootId: string | undefined,
    parentNodeId: string | undefined,
    selection: FocusSelection | undefined,
  ): string {
    return createHash("sha256").update(JSON.stringify({
      timelineId,
      content: input.content,
      clientMessageId: input.clientMessageId,
      model: input.model,
      relation,
      inquiryRootId,
      parentNodeId,
      focusSelection: selection,
      attachments: input.attachments?.map(({ id, name, mimeType, size, textContent }) => ({ id, name, mimeType, size, textContent })),
    })).digest("hex");
  }

  private inquiryError(code: string, message: string): ConflictException | UnprocessableEntityException {
    const status = code === "INQUIRY_SELECTION_STALE" ? 409 : 422;
    return new (status === 409 ? ConflictException : UnprocessableEntityException)({ error: { code, message } });
  }

  private ensureTurnEvents(turn: TurnRecord, failureMessage = MODEL_GATEWAY_FAILURE): void {
    if (turn.events.length) return;
    const turnId = turn.id;
    turn.events.push({ id: 1, event: "message.started", data: { turnId, message: { ...turn.assistantMessage, status: "streaming" } } });
    const chunks = turn.responseText.match(/.{1,28}/gs) ?? [turn.responseText];
    chunks.forEach((delta, index) => turn.events.push({
      id: index + 2,
      event: "message.delta",
      data: { turnId, messageId: turn.assistantMessage.id, sequence: index + 1, delta },
    }));
    turn.events.push({
      id: turn.events.length + 1, event: "message.failed",
      data: { turnId, messageId: turn.assistantMessage.id, error: failureMessage },
    });
  }

  private failTurn(turn: TurnRecord, message: string): void {
    const existingFailure = turn.events.find((event) => event.event === "message.failed");
    if (existingFailure) {
      existingFailure.data.error = message;
      this.applyTurnEvent(turn, existingFailure);
      return;
    }
    const event: TurnEvent = {
      id: (turn.events.at(-1)?.id ?? 0) + 1,
      event: "message.failed",
      data: { turnId: turn.id, messageId: turn.assistantMessage.id, error: message },
    };
    turn.events.push(event);
    this.applyTurnEvent(turn, event);
  }

  private applyTurnEvent(turn: TurnRecord, event: TurnEvent): void {
    if (turn.appliedEventIds.has(event.id)) return;
    turn.appliedEventIds.add(event.id);
    if (event.event === "message.started") {
      turn.status = "streaming";
      turn.assistantMessage.status = "streaming";
    } else if (event.event === "message.delta") {
      turn.status = "streaming";
      turn.assistantMessage.status = "streaming";
      turn.assistantMessage.content += String(event.data.delta ?? "");
    } else if (event.event === "message.completed") {
      turn.status = "complete";
      turn.assistantMessage.status = "complete";
      turn.assistantMessage.summary = this.summary(turn.assistantMessage.content);
    } else if (event.event === "message.failed") {
      turn.status = "failed";
      turn.assistantMessage.status = "failed";
      turn.assistantMessage.summary = String(event.data.error ?? "模型服务不可用");
    }
    this.bump();
  }

  private clearFinalizationTimer(turn: TurnRecord): void {
    if (turn.finalizationTimer) {
      clearTimeout(turn.finalizationTimer);
      turn.finalizationTimer = undefined;
    }
  }

  private scheduleDisconnectedTurnFailure(turn: TurnRecord): void {
    if (turn.finalizationTimer || turn.status === "complete" || turn.status === "failed") return;
    turn.finalizationTimer = setTimeout(() => {
      turn.finalizationTimer = undefined;
      if (turn.activeReaders === 0 && turn.status !== "complete" && turn.status !== "failed") {
        this.failTurn(turn, STREAM_DISCONNECTED_FAILURE);
      }
    }, 5_000);
    turn.finalizationTimer.unref?.();
  }

  forkFromMessage(
    messageId: string,
    input: { name?: string; contextMode: ContextMode },
    idempotencyKey?: string,
  ): Timeline {
    return this.idempotent("POST /message-forks", idempotencyKey, { messageId, ...input }, () => {
      const source = this.getNode(messageId);
      const parent = this.getTimeline(source.timelineId);
      const visible = this.visibleNodes(parent.id);
      if (!visible.some((node) => node.id === source.id)) {
        throw new UnprocessableEntityException({ error: { code: "FORK_POINT_INVALID", message: "分支点不在父时间线的可见上下文中" } });
      }
      const now = new Date().toISOString();
      const timeline: Timeline = {
        id: this.id("timeline"), conversationId: parent.conversationId,
        name: input.name?.trim() || `分支 · ${source.summary}`, parentTimelineId: parent.id,
        forkedFromNodeId: source.id, contextMode: input.contextMode, status: "active",
        color: colors[this.timelines.size % colors.length], createdAt: now, updatedAt: now,
      };
      this.timelines.set(timeline.id, timeline);
      this.bump();
      return timeline;
    });
  }

  compareTimelines(timelineIds: string[]) {
    const timelines = timelineIds.map((id) => this.getTimeline(id));
    if (new Set(timelines.map((timeline) => timeline.conversationId)).size > 1) {
      throw new UnprocessableEntityException({ error: { code: "TIMELINES_DIFFERENT_CONVERSATIONS", message: "只能比较同一对话中的时间线" } });
    }
    const visible = timelines.map((timeline) => this.visibleNodes(timeline.id).map((node) => node.id));
    const commonNodeIds = visible[0].filter((id) => visible.every((ids) => ids.includes(id)));
    const uniqueNodeIds = Object.fromEntries(timelines.map((timeline, index) => [timeline.id, visible[index].filter((id) => !commonNodeIds.includes(id))]));
    return { timelineIds, commonNodeIds, uniqueNodeIds };
  }

  mergeSummary(sourceIds: string[], targetId: string, idempotencyKey?: string): ConversationNode {
    return this.idempotent("POST /merge-summaries", idempotencyKey, { sourceIds, targetId }, () => {
      const target = this.getTimeline(targetId);
      const sources = sourceIds.map((id) => this.getTimeline(id));
      if (sources.some((timeline) => timeline.conversationId !== target.conversationId)) {
        throw new UnprocessableEntityException({ error: { code: "MERGE_DIFFERENT_CONVERSATIONS", message: "只能合并同一对话中的时间线" } });
      }
      const summaries = sources.map((timeline) => {
        const latest = this.primaryVisibleNodes(timeline.id).at(-1);
        return `${timeline.name}：${latest?.summary ?? "尚无独立结论"}`;
      });
      const now = new Date().toISOString();
      const node: ConversationNode = {
        id: this.id("node"), timelineId: target.id, parentNodeId: this.primaryVisibleNodes(target.id).at(-1)?.id,
        kind: "merge", content: `分支比较摘要\n\n${summaries.join("\n")}\n\n共同建议：保留可读的聊天主界面，用地图表达结构和风险。`,
        summary: "合并分支比较结论", sourceNodeIds: sources.flatMap((timeline) => this.visibleNodes(timeline.id).map((item) => item.id)),
        status: "complete", createdAt: now, metadata: { tags: ["合并摘要"] },
      };
      this.nodes.set(node.id, node);
      this.bump();
      return node;
    });
  }

  createReference(input: { sourceNodeId: string; targetTimelineId: string; label?: string }, idempotencyKey?: string) {
    return this.idempotent("POST /references", idempotencyKey, input, () => {
      const source = this.getNode(input.sourceNodeId);
      const targetTimeline = this.getTimeline(input.targetTimelineId);
      const sourceConversation = this.getTimeline(source.timelineId).conversationId;
      if (sourceConversation === targetTimeline.conversationId && source.timelineId === targetTimeline.id) {
        throw new UnprocessableEntityException({ error: { code: "REFERENCE_SELF_TIMELINE", message: "不能在同一时间线上创建自身引用" } });
      }
      const now = new Date().toISOString();
      const node: ConversationNode = {
        id: this.id("node"), timelineId: targetTimeline.id, parentNodeId: this.primaryVisibleNodes(targetTimeline.id).at(-1)?.id,
        kind: "reference", content: source.content, summary: `引用：${source.summary}`, sourceNodeIds: [source.id],
        status: "complete", createdAt: now, metadata: { boardName: this.getConversation(sourceConversation).title, tags: ["显式引用"] },
      };
      const link: ReferenceLink = { id: this.id("reference"), sourceNodeId: source.id, targetNodeId: node.id, label: input.label?.trim() || "手动引用", createdAt: now };
      this.nodes.set(node.id, node);
      this.references.set(link.id, link);
      this.bump();
      return { node, link };
    });
  }

  createThreat(input: { conversationId: string; nodeId: string; title: string; detail?: string; severity: ThreatSeverity }, idempotencyKey?: string): Threat {
    return this.idempotent("POST /threats", idempotencyKey, input, () => {
      const conversation = this.getConversation(input.conversationId);
      const node = this.getNode(input.nodeId);
      if (this.getTimeline(node.timelineId).conversationId !== conversation.id) {
        throw new UnprocessableEntityException({ error: { code: "THREAT_NODE_INVALID", message: "风险节点不属于当前对话" } });
      }
      const threat: Threat = { id: this.id("threat"), conversationId: conversation.id, nodeId: node.id, title: input.title, detail: input.detail ?? "", severity: input.severity, status: "open", version: 1, createdAt: new Date().toISOString() };
      this.threats.set(threat.id, threat);
      this.bump();
      return threat;
    });
  }

  resolveThreat(threatId: string, resolution: string, expectedVersion?: number, idempotencyKey?: string): Threat {
    return this.idempotent("PATCH /threats/resolve", idempotencyKey, { threatId, resolution, expectedVersion }, () => {
      const threat = this.threats.get(threatId);
      if (!threat) throw new NotFoundException({ error: { code: "THREAT_NOT_FOUND", message: "风险不存在" } });
      if (expectedVersion !== undefined && expectedVersion !== threat.version) {
        throw new ConflictException({ error: { code: "THREAT_VERSION_CONFLICT", message: "风险已被其他设备更新" } });
      }
      const next = { ...threat, status: "resolved" as const, resolution, version: threat.version + 1, resolvedAt: new Date().toISOString() };
      this.threats.set(threat.id, next);
      this.bump();
      return next;
    });
  }

  private turnResponse(turn: TurnRecord) {
    return { turnId: turn.id, userMessage: turn.userMessage, assistantMessage: turn.assistantMessage, eventsUrl: `/api/v1/turns/${turn.id}/events` };
  }

  private visibleNodes(timelineId: string): ConversationNode[] {
    const timeline = this.getTimeline(timelineId);
    let inherited: ConversationNode[] = [];
    if (timeline.parentTimelineId) {
      const parentNodes = this.visibleNodes(timeline.parentTimelineId);
      if (timeline.contextMode === "all") inherited = parentNodes;
      if (timeline.contextMode === "until-node") {
        const forkIndex = parentNodes.findIndex((node) => node.id === timeline.forkedFromNodeId);
        inherited = forkIndex >= 0 ? parentNodes.slice(0, forkIndex + 1) : [];
      }
      if (timeline.contextMode === "selected-only") {
        inherited = parentNodes.filter((node) => node.id === timeline.forkedFromNodeId);
      }
    }
    const own = [...this.nodes.values()].filter((node) => node.timelineId === timeline.id);
    return [...inherited, ...own].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private primaryVisibleNodes(timelineId: string) {
    return this.visibleNodes(timelineId).filter((node) => node.relation !== "focused-inquiry");
  }

  private getConversation(id: string) {
    const value = this.conversations.get(id);
    if (!value) throw new NotFoundException({ error: { code: "CONVERSATION_NOT_FOUND", message: "对话不存在" } });
    return value;
  }

  private getTimeline(id: string) {
    const value = this.timelines.get(id);
    if (!value) throw new NotFoundException({ error: { code: "TIMELINE_NOT_FOUND", message: "时间线不存在" } });
    return value;
  }

  private getNode(id: string) {
    const value = this.nodes.get(id);
    if (!value) throw new NotFoundException({ error: { code: "NODE_NOT_FOUND", message: "消息节点不存在" } });
    return value;
  }

  private summary(content: string) {
    return content.replace(/\s+/g, " ").trim().slice(0, 48) || "空消息";
  }

  private id(prefix: string) {
    return `${prefix}_${randomUUID()}`;
  }

  private bump() {
    this.version += 1;
  }

  private idempotent<T>(route: string, key: string | undefined, payload: unknown, action: () => T): T {
    if (!key) return action();
    const recordKey = `${route}:${key}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const existing = this.idempotency.get(recordKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ConflictException({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "幂等键已被不同请求使用" } });
      return existing.result as T;
    }
    const result = action();
    this.idempotency.set(recordKey, { fingerprint, result });
    return result;
  }
}
