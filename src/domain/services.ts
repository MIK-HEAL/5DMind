import type {
  ContextSnapshot,
  Conversation,
  CreateThreatInput,
  MessageEvent,
  Threat,
  Timeline,
  TimelineComparison,
  ConversationNode,
  ReferenceLink,
} from "./types";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SendMessageInput {
  timelineId: string;
  content: string;
  clientMessageId: string;
  parentNodeId?: string;
  inquiryRootId?: string;
  model?: string;
  providerId?: string;
  providerType?: string;
  baseUrl?: string;
  apiPath?: string;
  requestTimeoutMs?: number;
  instructions?: string;
  temperature?: number;
  relation?: ConversationNode["relation"];
  focusSelection?: ConversationNode["focusSelection"];
  history?: ConversationTurn[];
  signal?: AbortSignal;
}

export interface ConversationService {
  createConversation(title: string): Promise<Conversation>;
  sendMessage(input: SendMessageInput): AsyncIterable<MessageEvent>;
  getContext(timelineId: string): Promise<ContextSnapshot>;
}

export interface TimelineService {
  forkFromMessage(messageId: string, name?: string): Promise<Timeline>;
  switchTimeline(timelineId: string): Promise<void>;
  compareTimelines(ids: string[]): Promise<TimelineComparison>;
  mergeSummary(sourceIds: string[], targetId: string): Promise<ConversationNode>;
}

export interface ThreatService {
  createThreat(input: CreateThreatInput): Promise<Threat>;
  resolveThreat(threatId: string, resolution: string, expectedVersion?: number): Promise<Threat>;
}

export interface ReferenceService {
  createReference(input: {
    sourceNodeId: string;
    targetTimelineId: string;
    label?: string;
  }): Promise<{ node: ConversationNode; link: ReferenceLink }>;
}
