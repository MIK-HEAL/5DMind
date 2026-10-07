import type { ConversationNode, NodeId, Timeline, TimelineId, WorkspaceSnapshot } from "./types";

export function isFocusedInquiry(node: ConversationNode) {
  return node.relation === "focused-inquiry";
}

export function getFocusedInquiryRoots(snapshot: WorkspaceSnapshot, sourceNodeId: NodeId, timelineId?: TimelineId) {
  return snapshot.nodes
    .filter((node) => node.kind === "user" && isFocusedInquiry(node) && node.focusSelection?.sourceNodeId === sourceNodeId && (!timelineId || node.timelineId === timelineId))
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

export function getOwnNodes(
  snapshot: WorkspaceSnapshot,
  timelineId: TimelineId,
): ConversationNode[] {
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

export function getConversationTimelines(
  snapshot: WorkspaceSnapshot,
  conversationId: string,
): Timeline[] {
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
  return getTimelineNodes(snapshot, timelineId).filter((node) => !isFocusedInquiry(node)).at(-1);
}
