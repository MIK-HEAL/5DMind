export type ConversationId = string;
export type TimelineId = string;
export type NodeId = string;
export type ThreatId = string;

export type ContextMode = "all" | "until-node" | "selected-only";
export type NodeKind = "user" | "assistant" | "system" | "reference" | "merge";

export interface FocusSelection {
  sourceNodeId: NodeId;
  text: string;
  start?: number;
  end?: number;
  contentHash: string;
}

export interface Conversation {
  id: ConversationId;
  title: string;
  summary: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Timeline {
  id: TimelineId;
  conversationId: ConversationId;
  name: string;
  parentTimelineId?: TimelineId;
  forkedFromNodeId?: NodeId;
  contextMode: ContextMode;
  status: "active" | "archived";
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNode {
  id: NodeId;
  timelineId: TimelineId;
  parentNodeId?: NodeId;
  relation?: "main" | "branch" | "focused-inquiry";
  inquiryRootId?: NodeId;
  focusSelection?: FocusSelection;
  kind: NodeKind;
  content: string;
  summary: string;
  sourceNodeIds?: NodeId[];
  status: "pending" | "streaming" | "complete" | "failed";
  createdAt: string;
  metadata: {
    model?: string;
    author?: string;
    boardName?: string;
    reasoning?: string;
    tags?: string[];
  };
}

export interface Threat {
  id: ThreatId;
  conversationId: ConversationId;
  nodeId: NodeId;
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved";
  version?: number;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface GraphSnapshot {
  version: number;
  conversation: Conversation;
  timelines: Timeline[];
  nodes: ConversationNode[];
  threats: Threat[];
  references: ReferenceLink[];
  serverTime: string;
}

export interface ReferenceLink {
  id: string;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  label: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  version: 1;
  conversations: Conversation[];
  timelines: Timeline[];
  nodes: ConversationNode[];
  threats: Threat[];
  references: ReferenceLink[];
  currentConversationId: ConversationId;
  currentTimelineId: TimelineId;
}

export type MessageEvent =
  | { type: "message.started"; message: ConversationNode }
  | { type: "message.delta"; messageId: NodeId; delta: string }
  | { type: "message.reasoning_delta"; messageId: NodeId; delta: string }
  | { type: "message.completed"; messageId: NodeId }
  | { type: "message.failed"; messageId: NodeId; error: string };

export interface ContextSnapshot {
  timeline: Timeline;
  nodes: ConversationNode[];
  inheritedNodeCount: number;
}

export interface TimelineComparison {
  timelineIds: TimelineId[];
  commonNodeIds: NodeId[];
  uniqueNodeIds: Record<TimelineId, NodeId[]>;
}

export interface CreateThreatInput {
  conversationId: ConversationId;
  nodeId: NodeId;
  title: string;
  detail?: string;
  severity: Threat["severity"];
}
