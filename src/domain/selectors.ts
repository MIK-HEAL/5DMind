import type {
  Conversation,
  ConversationNode,
  NodeId,
  Timeline,
  TimelineId,
  WorkspaceSnapshot,
} from "./types";

export interface SearchOptions {
  /** "all" searches every conversation; "current" limits to the active conversation. */
  scope?: "all" | "current";
  /** Maximum number of node matches returned. Defaults to 60. */
  limit?: number;
}

export interface MatchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface NodeSearchMatch {
  node: ConversationNode;
  timeline?: Timeline;
  conversation?: Conversation;
  /** Field the query was found in; content matches take precedence over reasoning. */
  matchedField: "content" | "reasoning";
  /** Character index of the first match inside the matched field. */
  matchIndex: number;
  /** Total case-insensitive occurrences inside node content. */
  matchCount: number;
  snippet: MatchSnippet;
}

export interface TimelineSearchMatch {
  timeline: Timeline;
  conversation?: Conversation;
}

export interface ConversationSearchMatch {
  conversation: Conversation;
  matchIndex: number;
}

export interface WorkspaceSearchResults {
  query: string;
  conversations: ConversationSearchMatch[];
  timelines: TimelineSearchMatch[];
  nodes: NodeSearchMatch[];
  /** Total node matches before the limit was applied. */
  totalNodeMatches: number;
}

function countOccurrences(haystack: string, needle: string) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Builds a display snippet centred on the first case-insensitive match. */
export function extractMatchSnippet(text: string, query: string, radius?: { before: number; after: number }): MatchSnippet {
  const { before = 24, after = 76 } = radius ?? {};
  const matchIndex = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchIndex < 0) return { before: text.slice(0, before), match: "", after: "" };
  const start = Math.max(0, matchIndex - before);
  const matchEnd = matchIndex + query.length;
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, matchIndex),
    match: text.slice(matchIndex, matchEnd),
    after: text.slice(matchEnd, matchEnd + after) + (matchEnd + after < text.length ? "…" : ""),
  };
}

function toNodeSearchMatch(
  node: ConversationNode,
  timeline: Timeline | undefined,
  conversation: Conversation | undefined,
  query: string,
): NodeSearchMatch | undefined {
  const needle = query.toLocaleLowerCase();
  const content = node.content ?? "";
  const contentIndex = content.toLocaleLowerCase().indexOf(needle);
  if (contentIndex >= 0) {
    return {
      node,
      timeline,
      conversation,
      matchedField: "content",
      matchIndex: contentIndex,
      matchCount: countOccurrences(content.toLocaleLowerCase(), needle),
      snippet: extractMatchSnippet(content, query),
    };
  }
  const reasoning = node.metadata.reasoning ?? "";
  const reasoningIndex = reasoning.toLocaleLowerCase().indexOf(needle);
  if (reasoningIndex >= 0) {
    return {
      node,
      timeline,
      conversation,
      matchedField: "reasoning",
      matchIndex: reasoningIndex,
      matchCount: countOccurrences(reasoning.toLocaleLowerCase(), needle),
      snippet: extractMatchSnippet(reasoning, query),
    };
  }
  return undefined;
}

/** Searches every message node (content first, then reasoning) across the workspace. */
export function searchNodes(
  snapshot: WorkspaceSnapshot,
  query: string,
  options?: SearchOptions,
): NodeSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const scope = options?.scope ?? "all";
  const limit = options?.limit ?? 60;
  const timelineById = new Map(snapshot.timelines.map((timeline) => [timeline.id, timeline]));
  const conversationById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
  const conversationFilter = scope === "current" ? snapshot.currentConversationId : undefined;

  const matches: NodeSearchMatch[] = [];
  for (const node of snapshot.nodes) {
    const timeline = timelineById.get(node.timelineId);
    if (conversationFilter && timeline?.conversationId !== conversationFilter) continue;
    const match = toNodeSearchMatch(node, timeline, timeline ? conversationById.get(timeline.conversationId) : undefined, needle);
    if (match) matches.push(match);
  }

  matches.sort((a, b) => {
    if (a.matchedField !== b.matchedField) return a.matchedField === "content" ? -1 : 1;
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    return b.node.createdAt.localeCompare(a.node.createdAt);
  });
  return matches.slice(0, limit);
}

/** Unified workspace search across conversations (titles), timelines (names) and message nodes. */
export function searchWorkspace(
  snapshot: WorkspaceSnapshot,
  query: string,
  options?: SearchOptions,
): WorkspaceSearchResults {
  const needle = query.trim();
  const scope = options?.scope ?? "all";
  const needleLower = needle.toLocaleLowerCase();
  const conversationById = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));

  const conversations = needle
    ? snapshot.conversations
        .filter((conversation) => conversation.title.toLocaleLowerCase().includes(needleLower))
        .map((conversation) => ({
          conversation,
          matchIndex: conversation.title.toLocaleLowerCase().indexOf(needleLower),
        }))
        .sort((a, b) => a.matchIndex - b.matchIndex)
    : [];

  const timelineMatches = needle
    ? snapshot.timelines
        .filter((timeline) => timeline.status === "active")
        .filter((timeline) => {
          if (scope === "current") return timeline.conversationId === snapshot.currentConversationId;
          return true;
        })
        .filter((timeline) => timeline.name.toLocaleLowerCase().includes(needleLower))
        .map((timeline) => ({ timeline, conversation: conversationById.get(timeline.conversationId) }))
    : [];

  const nodes = searchNodes(snapshot, needle, { scope, limit: options?.limit });
  const totalNodeMatches = needle
    ? snapshot.nodes.reduce((count, node) => {
        if (scope === "current" && !isNodeInConversation(node, snapshot)) return count;
        const haystack = `${node.content ?? ""}\n${node.metadata.reasoning ?? ""}`.toLocaleLowerCase();
        return haystack.includes(needleLower) ? count + 1 : count;
      }, 0)
    : 0;

  return {
    query: needle,
    conversations,
    timelines: timelineMatches,
    nodes,
    totalNodeMatches,
  };
}

function isNodeInConversation(node: ConversationNode, snapshot: WorkspaceSnapshot) {
  const timeline = snapshot.timelines.find((item) => item.id === node.timelineId);
  return timeline?.conversationId === snapshot.currentConversationId;
}

export function isFocusedInquiry(node: ConversationNode) {
  return node.relation === "focused-inquiry";
}

export function getFocusedInquiryRoots(snapshot: WorkspaceSnapshot, sourceNodeId: NodeId, timelineId?: TimelineId) {
  return snapshot.nodes
    .filter(
      (node) =>
        node.kind === "user" &&
        isFocusedInquiry(node) &&
        node.focusSelection?.sourceNodeId === sourceNodeId &&
        (!timelineId || node.timelineId === timelineId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getInquiryTree(snapshot: WorkspaceSnapshot, rootNodeId: NodeId) {
  const tree: ConversationNode[] = [];
  const visit = (parentId: NodeId) => {
    const children = snapshot.nodes
      .filter((node) => isFocusedInquiry(node) && node.parentNodeId === parentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    children.forEach((node) => {
      tree.push(node);
      visit(node.id);
    });
  };
  const root = snapshot.nodes.find((node) => node.id === rootNodeId);
  if (root && isFocusedInquiry(root)) {
    tree.push(root);
    visit(root.id);
  }
  return tree;
}

export function getTimeline(snapshot: WorkspaceSnapshot, timelineId: TimelineId): Timeline {
  const timeline = snapshot.timelines.find((item) => item.id === timelineId);
  if (!timeline) throw new Error(`Unknown timeline: ${timelineId}`);
  return timeline;
}

export function getOwnNodes(snapshot: WorkspaceSnapshot, timelineId: TimelineId): ConversationNode[] {
  return snapshot.nodes
    .filter((node) => node.timelineId === timelineId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getTimelineNodes(
  snapshot: WorkspaceSnapshot,
  timelineId: TimelineId,
  visited = new Set<TimelineId>(),
): ConversationNode[] {
  if (visited.has(timelineId)) return [];
  visited.add(timelineId);

  const timeline = getTimeline(snapshot, timelineId);
  const ownNodes = getOwnNodes(snapshot, timelineId);
  if (!timeline.parentTimelineId || !timeline.forkedFromNodeId) return ownNodes;

  const parentNodes = getTimelineNodes(snapshot, timeline.parentTimelineId, visited);
  if (timeline.contextMode === "selected-only") {
    const selected = parentNodes.find((node) => node.id === timeline.forkedFromNodeId);
    return selected ? [selected, ...ownNodes] : ownNodes;
  }

  if (timeline.contextMode === "all") return [...parentNodes, ...ownNodes];
  const forkIndex = parentNodes.findIndex((node) => node.id === timeline.forkedFromNodeId);
  const inherited = forkIndex >= 0 ? parentNodes.slice(0, forkIndex + 1) : parentNodes;
  return [...inherited, ...ownNodes];
}

export function getConversationTimelines(snapshot: WorkspaceSnapshot, conversationId: string): Timeline[] {
  return snapshot.timelines
    .filter((timeline) => timeline.conversationId === conversationId && timeline.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getNode(snapshot: WorkspaceSnapshot, nodeId: string) {
  return snapshot.nodes.find((node) => node.id === nodeId);
}

export function getNodeThreats(snapshot: WorkspaceSnapshot, nodeId: string) {
  return snapshot.threats.filter((threat) => threat.nodeId === nodeId);
}

export function getLastNode(snapshot: WorkspaceSnapshot, timelineId: string) {
  return getTimelineNodes(snapshot, timelineId)
    .filter((node) => !isFocusedInquiry(node))
    .at(-1);
}
