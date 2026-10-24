import { describe, expect, it } from "vitest";
import { getFocusedInquiryRoots, getInquiryTree, getLastNode, getTimelineNodes } from "./selectors";
import type { WorkspaceSnapshot } from "./types";

const testWorkspace: WorkspaceSnapshot = {
  version: 1,
  currentConversationId: "conversation-test",
  currentTimelineId: "timeline-main",
  conversations: [{
    id: "conversation-test", title: "测试工作区", summary: "", color: "#206b5a",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }],
  timelines: [
    {
      id: "timeline-main", conversationId: "conversation-test", name: "主线",
      contextMode: "until-node", status: "active", color: "#206b5a",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "timeline-branch", conversationId: "conversation-test", name: "分支",
      parentTimelineId: "timeline-main", forkedFromNodeId: "node-3", contextMode: "until-node",
      status: "active", color: "#ce6d39", createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z",
    },
  ],
  nodes: [
    { id: "node-1", timelineId: "timeline-main", kind: "user", content: "1", summary: "1", status: "complete", createdAt: "2026-01-01T00:00:00.000Z", metadata: {} },
    { id: "node-2", timelineId: "timeline-main", parentNodeId: "node-1", kind: "assistant", content: "2", summary: "2", status: "complete", createdAt: "2026-01-01T00:01:00.000Z", metadata: {} },
    { id: "node-3", timelineId: "timeline-main", parentNodeId: "node-2", kind: "user", content: "3", summary: "3", status: "complete", createdAt: "2026-01-01T00:02:00.000Z", metadata: {} },
    { id: "branch-1", timelineId: "timeline-branch", parentNodeId: "node-3", kind: "user", content: "branch", summary: "branch", status: "complete", createdAt: "2026-01-01T00:05:00.000Z", metadata: {} },
    { id: "branch-2", timelineId: "timeline-branch", parentNodeId: "branch-1", kind: "assistant", content: "branch answer", summary: "branch answer", status: "complete", createdAt: "2026-01-01T00:06:00.000Z", metadata: {} },
    { id: "other-1", timelineId: "timeline-main", kind: "system", content: "main", summary: "main", status: "complete", createdAt: "2026-01-01T00:07:00.000Z", metadata: {} },
  ],
  threats: [],
  references: [],
};

describe("getTimelineNodes", () => {
  it("inherits parent context only through the fork node", () => {
    const ids = getTimelineNodes(testWorkspace, "timeline-branch").map((node) => node.id);
    expect(ids).toEqual(["node-1", "node-2", "node-3", "branch-1", "branch-2"]);
  });

  it("keeps the mainline independent from branch nodes", () => {
    const ids = getTimelineNodes(testWorkspace, "timeline-main").map((node) => node.id);
    expect(ids).not.toContain("branch-1");
    expect(ids).not.toContain("branch-2");
  });
});

describe("focused inquiries", () => {
  it("keeps inquiry nodes out of the main latest-node pointer while retaining their tree", () => {
    const snapshot: WorkspaceSnapshot = {
      ...testWorkspace,
      nodes: [
        ...testWorkspace.nodes,
        {
          id: "inquiry-1", timelineId: "timeline-main", parentNodeId: "node-2", relation: "focused-inquiry",
          focusSelection: { sourceNodeId: "node-2", text: "专有名词", contentHash: "abc" }, kind: "user",
          content: "这个词是什么意思？", summary: "这个词是什么意思？", status: "complete",
          createdAt: "2026-01-01T00:08:00.000Z", metadata: {},
        },
        {
          id: "inquiry-2", timelineId: "timeline-main", parentNodeId: "inquiry-1", relation: "focused-inquiry",
          kind: "assistant", content: "这是追问解释", summary: "这是追问解释", status: "complete",
          createdAt: "2026-01-01T00:09:00.000Z", metadata: {},
        },
      ],
    };
    expect(getFocusedInquiryRoots(snapshot, "node-2", "timeline-main").map((node) => node.id)).toEqual(["inquiry-1"]);
    expect(getInquiryTree(snapshot, "inquiry-1").map((node) => node.id)).toEqual(["inquiry-1", "inquiry-2"]);
    expect(getLastNode(snapshot, "timeline-main")?.id).toBe("other-1");
  });
});
