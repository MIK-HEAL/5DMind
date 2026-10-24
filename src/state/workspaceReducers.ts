import type { ContextMode, ConversationNode, MessageEvent, Threat, Timeline, WorkspaceSnapshot } from "../domain/types";
import { getInquiryTree, getLastNode, getNode, getOwnNodes, getTimelineNodes } from "../domain/selectors";

const FORK_COLORS = ["#a84d35", "#4b67b0", "#7a5ba6", "#ce6d39"];

export function activateConversation(current: WorkspaceSnapshot, conversationId: string): WorkspaceSnapshot {
  const timeline = current.timelines.find((item) => item.conversationId === conversationId && item.status === "active");
  if (!timeline) return current;
  return { ...current, currentConversationId: conversationId, currentTimelineId: timeline.id };
}

export function activateTimeline(current: WorkspaceSnapshot, timelineId: string): WorkspaceSnapshot {
  const timeline = current.timelines.find((item) => item.id === timelineId);
  if (!timeline) return current;
  return {
    ...current,
    currentConversationId: timeline.conversationId,
    currentTimelineId: timeline.id,
  };
}

/** Ensures the timeline owning `nodeId` is the active one when the node is not visible on the current timeline. */
export function revealNode(current: WorkspaceSnapshot, nodeId: string): WorkspaceSnapshot {
  const node = getNode(current, nodeId);
  if (!node) return current;
  const visibleOnCurrent = getTimelineNodes(current, current.currentTimelineId).some((item) => item.id === nodeId);
  if (visibleOnCurrent) return current;
  const timeline = current.timelines.find((item) => item.id === node.timelineId);
  if (!timeline) return current;
  return {
    ...current,
    currentConversationId: timeline.conversationId,
    currentTimelineId: timeline.id,
  };
}

/** Toggles a timeline in the compare list, keeping at most two entries. */
export function toggleCompareId(current: string[], timelineId: string): string[] {
  if (current.includes(timelineId)) return current.filter((id) => id !== timelineId);
  return [...current.slice(-1), timelineId];
}

export interface CloseInquiryResult {
  openIds: string[];
  updateFocus: boolean;
  focusedInquiryId?: string;
}

/** Closes an inquiry window and recomputes which inquiry should receive focus. */
export function closeInquiryWindow(
  current: WorkspaceSnapshot,
  openIds: string[],
  windowRootId: string,
  activeNodeId?: string,
): CloseInquiryResult {
  const nextIds = openIds.filter((id) => id !== windowRootId);
  const activeBelongsToWindow = Boolean(
    activeNodeId && getInquiryTree(current, windowRootId).some((node) => node.id === activeNodeId),
  );
  return {
    openIds: nextIds,
    updateFocus: activeBelongsToWindow,
    focusedInquiryId: activeBelongsToWindow ? nextIds.at(-1) : activeNodeId,
  };
}

export function forkTimeline(
  current: WorkspaceSnapshot,
  input: { nodeId: string; name: string; contextMode: ContextMode; timelineId: string; now: string },
): WorkspaceSnapshot {
  const source = getNode(current, input.nodeId);
  if (!source) return current;
  const timeline: Timeline = {
    id: input.timelineId,
    conversationId: current.currentConversationId,
    name: input.name.trim() || `分支 · ${source.summary}`,
    parentTimelineId: current.currentTimelineId,
    forkedFromNodeId: input.nodeId,
    contextMode: input.contextMode,
    status: "active",
    color: FORK_COLORS[current.timelines.length % FORK_COLORS.length],
    createdAt: input.now,
    updatedAt: input.now,
  };
  return { ...current, timelines: [...current.timelines, timeline], currentTimelineId: input.timelineId };
}

export function appendThreat(current: WorkspaceSnapshot, threat: Threat): WorkspaceSnapshot {
  return { ...current, threats: [...current.threats, threat] };
}

export function resolveThreatById(
  current: WorkspaceSnapshot,
  threatId: string,
  resolution: string,
  now: string,
): WorkspaceSnapshot {
  return {
    ...current,
    threats: current.threats.map((threat) =>
      threat.id === threatId ? { ...threat, status: "resolved" as const, resolution, resolvedAt: now } : threat,
    ),
  };
}

export function appendManualReference(
  current: WorkspaceSnapshot,
  input: { sourceNodeId: string; nodeId: string; referenceId: string; now: string },
): WorkspaceSnapshot {
  const source = getNode(current, input.sourceNodeId);
  if (!source) return current;
  const timelineId = current.currentTimelineId;
  const sourceTimeline = current.timelines.find((item) => item.id === source.timelineId);
  const sourceConversation = current.conversations.find((item) => item.id === sourceTimeline?.conversationId);
  const target: ConversationNode = {
    id: input.nodeId,
    timelineId,
    parentNodeId: getLastNode(current, timelineId)?.id,
    kind: "reference",
    content: source.content,
    summary: `引用：${source.summary}`,
    sourceNodeIds: [source.id],
    status: "complete",
    createdAt: input.now,
    metadata: { boardName: sourceConversation?.title ?? "当前工作区", tags: ["显式引用"] },
  };
  return {
    ...current,
    nodes: [...current.nodes, target],
    references: [
      ...current.references,
      {
        id: input.referenceId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.nodeId,
        label: "手动引用",
        createdAt: input.now,
      },
    ],
  };
}

/** Appends the branch comparison summary node for the two compared timelines. */
export function appendMergeSummary(
  current: WorkspaceSnapshot,
  compareIds: string[],
  nodeId: string,
  now: string,
): WorkspaceSnapshot {
  const summaries = compareIds.map((id) => {
    const timeline = current.timelines.find((item) => item.id === id);
    const conclusion = getOwnNodes(current, id).at(-1);
    return `${timeline?.name ?? id}：${conclusion?.summary ?? "尚无独立结论"}`;
  });
  const node: ConversationNode = {
    id: nodeId,
    timelineId: current.currentTimelineId,
    parentNodeId: getLastNode(current, current.currentTimelineId)?.id,
    kind: "merge",
    content: `分支比较摘要\n\n${summaries.join("\n")}\n\n共同建议：保留可读的聊天主界面，用地图表达结构和风险，并继续用真实任务验证。`,
    summary: "合并两条分支的比较结论",
    sourceNodeIds: compareIds.flatMap((id) => getOwnNodes(current, id).map((node) => node.id)),
    status: "complete",
    createdAt: now,
    metadata: { tags: ["合并摘要"] },
  };
  return { ...current, nodes: [...current.nodes, node] };
}

export function renameConversationById(
  current: WorkspaceSnapshot,
  conversationId: string,
  title: string,
  now: string,
): WorkspaceSnapshot {
  return {
    ...current,
    conversations: current.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, title, updatedAt: now } : conversation,
    ),
  };
}

/** Removes a conversation together with its timelines, nodes, threats and references. */
export function removeConversationCascade(current: WorkspaceSnapshot, conversationId: string): WorkspaceSnapshot {
  if (current.conversations.length <= 1) return current;
  const timelineIds = new Set(
    current.timelines.filter((timeline) => timeline.conversationId === conversationId).map((timeline) => timeline.id),
  );
  const nodeIds = new Set(current.nodes.filter((node) => timelineIds.has(node.timelineId)).map((node) => node.id));
  const conversations = current.conversations.filter((conversation) => conversation.id !== conversationId);
  const nextConversation =
    conversations.find((conversation) => conversation.id === current.currentConversationId) ?? conversations[0];
  const nextTimeline =
    current.timelines.find(
      (timeline) => timeline.conversationId === nextConversation.id && timeline.status === "active",
    ) ?? current.timelines.find((timeline) => timeline.conversationId === nextConversation.id);
  return {
    ...current,
    conversations,
    timelines: current.timelines.filter((timeline) => !timelineIds.has(timeline.id)),
    nodes: current.nodes.filter((node) => !nodeIds.has(node.id)),
    threats: current.threats.filter((threat) => threat.conversationId !== conversationId),
    references: current.references.filter(
      (reference) => !nodeIds.has(reference.sourceNodeId) && !nodeIds.has(reference.targetNodeId),
    ),
    currentConversationId: nextConversation.id,
    currentTimelineId: nextTimeline?.id ?? current.currentTimelineId,
  };
}

/** Removes a message together with its descendant subtree and related threats/references. */
export function removeMessageCascade(current: WorkspaceSnapshot, messageId: string): WorkspaceSnapshot {
  const root = getNode(current, messageId);
  if (!root) return current;
  const removedIds = new Set([messageId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of current.nodes) {
      if (
        node.timelineId === root.timelineId &&
        node.parentNodeId &&
        removedIds.has(node.parentNodeId) &&
        !removedIds.has(node.id)
      ) {
        removedIds.add(node.id);
        expanded = true;
      }
    }
  }
  return {
    ...current,
    nodes: current.nodes.filter((node) => !removedIds.has(node.id)),
    threats: current.threats.filter((threat) => !removedIds.has(threat.nodeId)),
    references: current.references.filter(
      (reference) => !removedIds.has(reference.sourceNodeId) && !removedIds.has(reference.targetNodeId),
    ),
  };
}

export function appendConversation(
  current: WorkspaceSnapshot,
  input: { conversationId: string; timelineId: string; title: string; now: string },
): WorkspaceSnapshot {
  return {
    ...current,
    conversations: [
      ...current.conversations,
      {
        id: input.conversationId,
        title: input.title,
        summary: "新的本地工作区",
        color: "#7a5ba6",
        createdAt: input.now,
        updatedAt: input.now,
      },
    ],
    timelines: [
      ...current.timelines,
      {
        id: input.timelineId,
        conversationId: input.conversationId,
        name: "主线",
        contextMode: "until-node",
        status: "active",
        color: "#7a5ba6",
        createdAt: input.now,
        updatedAt: input.now,
      },
    ],
    currentConversationId: input.conversationId,
    currentTimelineId: input.timelineId,
  };
}

export interface MessageEventContext {
  /** Node id that streamed assistant messages attach to (the user message that started the turn). */
  parentNodeId: string;
  author: string;
  model?: string;
  relation?: ConversationNode["relation"];
  inquiryRootId?: string;
  tags?: string[];
  completedSummary: string;
}

/** Applies a streaming message event to the snapshot (shared by chat and focused inquiry flows). */
export function applyMessageEvent(
  current: WorkspaceSnapshot,
  event: MessageEvent,
  context: MessageEventContext,
): WorkspaceSnapshot {
  switch (event.type) {
    case "message.started": {
      const node: ConversationNode = {
        ...event.message,
        parentNodeId: context.parentNodeId,
        ...(context.relation !== undefined ? { relation: context.relation } : {}),
        ...(context.inquiryRootId !== undefined ? { inquiryRootId: context.inquiryRootId } : {}),
        metadata: {
          ...event.message.metadata,
          author: context.author,
          model: event.message.metadata.model ?? context.model,
          ...(context.tags ? { tags: [...(event.message.metadata.tags ?? []), ...context.tags] } : {}),
        },
      };
      return { ...current, nodes: [...current.nodes, node] };
    }
    case "message.delta":
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === event.messageId ? { ...node, content: node.content + event.delta } : node,
        ),
      };
    case "message.reasoning_delta":
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === event.messageId
            ? {
                ...node,
                metadata: { ...node.metadata, reasoning: `${node.metadata.reasoning ?? ""}${event.delta}` },
              }
            : node,
        ),
      };
    case "message.completed":
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === event.messageId ? { ...node, status: "complete", summary: context.completedSummary } : node,
        ),
      };
    case "message.failed":
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === event.messageId ? { ...node, status: "failed", summary: event.error } : node,
        ),
      };
  }
}

export function buildFailedReplyNode(input: {
  id: string;
  timelineId: string;
  parentNodeId: string;
  detail: string;
  author: string;
  model?: string;
  inquiryRootId?: string;
  now: string;
}): ConversationNode {
  const isInquiry = input.inquiryRootId !== undefined;
  return {
    id: input.id,
    timelineId: input.timelineId,
    parentNodeId: input.parentNodeId,
    ...(isInquiry ? { relation: "focused-inquiry" as const, inquiryRootId: input.inquiryRootId } : {}),
    kind: "assistant",
    content: isInquiry ? `无法生成追问回复\n\n${input.detail}` : `无法生成回复\n\n${input.detail}`,
    summary: isInquiry ? "追问回复失败" : "回复失败",
    status: "failed",
    createdAt: input.now,
    metadata: {
      author: input.author,
      model: input.model || "未配置模型",
      ...(isInquiry ? { tags: ["选区追问"] } : {}),
    },
  };
}
