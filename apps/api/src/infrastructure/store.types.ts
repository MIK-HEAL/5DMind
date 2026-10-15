export type ContextMode = "all" | "until-node" | "selected-only";
export type NodeKind = "user" | "assistant" | "system" | "reference" | "merge";
export type NodeStatus = "pending" | "streaming" | "complete" | "failed";
export type NodeRelation = "main" | "branch" | "focused-inquiry";
export type ThreatSeverity = "low" | "medium" | "high";

export interface FocusSelection {
  sourceNodeId: string;
  text: string;
  start?: number;
  end?: number;
  contentHash: string;
}

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Timeline {
  id: string;
  conversationId: string;
  name: string;
  parentTimelineId?: string;
  forkedFromNodeId?: string;
  contextMode: ContextMode;
  status: "active" | "archived";
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNode {
  id: string;
  timelineId: string;
  parentNodeId?: string;
  relation?: NodeRelation;
  inquiryRootId?: string;
  focusSelection?: FocusSelection;
  kind: NodeKind;
  content: string;
  summary: string;
  sourceNodeIds?: string[];
  status: NodeStatus;
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
  id: string;
  conversationId: string;
  nodeId: string;
  title: string;
  detail: string;
  severity: ThreatSeverity;
  status: "open" | "resolved";
  resolution?: string;
  version: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface ReferenceLink {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  createdAt: string;
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

export interface TurnEvent {
  id: number;
  event: "message.started" | "message.delta" | "message.completed" | "message.failed" | "turn.heartbeat";
  data: Record<string, unknown>;
}

export interface TurnRecord {
  id: string;
  timelineId: string;
  userMessage: ConversationNode;
  assistantMessage: ConversationNode;
  events: TurnEvent[];
  responseText: string;
  model: string;
  status: "pending" | "streaming" | "complete" | "failed";
  requestFingerprint: string;
  context: TurnContext;
  appliedEventIds: Set<number>;
  activeReaders: number;
  finalizationTimer?: ReturnType<typeof setTimeout>;
}

export interface TurnContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
  nodeId?: string;
}

export interface TurnContext {
  timelineId: string;
  relation: NodeRelation;
  inquiryRootId?: string;
  parentNodeId?: string;
  messages: TurnContextMessage[];
  focusSelection?: FocusSelection;
}
