import { describe, expect, it } from "vitest";
import {
  extractMatchSnippet,
  getFocusedInquiryRoots,
  getInquiryTree,
  getLastNode,
  getTimelineNodes,
  searchNodes,
  searchWorkspace,
} from "./selectors";
import type { WorkspaceSnapshot } from "./types";

const testWorkspace: WorkspaceSnapshot = {
  version: 1,
  currentConversationId: "conversation-test",
  currentTimelineId: "timeline-main",
  conversations: [
    {
      id: "conversation-test",
      title: "测试工作区",
      summary: "",
      color: "#206b5a",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  timelines: [
    {
      id: "timeline-main",
      conversationId: "conversation-test",
      name: "主线",
      contextMode: "until-node",
      status: "active",
      color: "#206b5a",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "timeline-branch",
      conversationId: "conversation-test",
      name: "分支",
      parentTimelineId: "timeline-main",
      forkedFromNodeId: "node-3",
      contextMode: "until-node",
      status: "active",
      color: "#ce6d39",
      createdAt: "2026-01-01T00:04:00.000Z",
      updatedAt: "2026-01-01T00:04:00.000Z",
    },
  ],
  nodes: [
    {
      id: "node-1",
      timelineId: "timeline-main",
      kind: "user",
      content: "1",
      summary: "1",
      status: "complete",
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    },
    {
      id: "node-2",
      timelineId: "timeline-main",
      parentNodeId: "node-1",
      kind: "assistant",
      content: "2",
      summary: "2",
      status: "complete",
      createdAt: "2026-01-01T00:01:00.000Z",
      metadata: {},
    },
    {
      id: "node-3",
      timelineId: "timeline-main",
      parentNodeId: "node-2",
      kind: "user",
      content: "3",
      summary: "3",
      status: "complete",
      createdAt: "2026-01-01T00:02:00.000Z",
      metadata: {},
    },
    {
      id: "branch-1",
      timelineId: "timeline-branch",
      parentNodeId: "node-3",
      kind: "user",
      content: "branch",
      summary: "branch",
      status: "complete",
      createdAt: "2026-01-01T00:05:00.000Z",
      metadata: {},
    },
    {
      id: "branch-2",
      timelineId: "timeline-branch",
      parentNodeId: "branch-1",
      kind: "assistant",
      content: "branch answer",
      summary: "branch answer",
      status: "complete",
      createdAt: "2026-01-01T00:06:00.000Z",
      metadata: {},
    },
    {
      id: "other-1",
      timelineId: "timeline-main",
      kind: "system",
      content: "main",
      summary: "main",
      status: "complete",
      createdAt: "2026-01-01T00:07:00.000Z",
      metadata: {},
    },
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
          id: "inquiry-1",
          timelineId: "timeline-main",
          parentNodeId: "node-2",
          relation: "focused-inquiry",
          focusSelection: { sourceNodeId: "node-2", text: "专有名词", contentHash: "abc" },
          kind: "user",
          content: "这个词是什么意思？",
          summary: "这个词是什么意思？",
          status: "complete",
          createdAt: "2026-01-01T00:08:00.000Z",
          metadata: {},
        },
        {
          id: "inquiry-2",
          timelineId: "timeline-main",
          parentNodeId: "inquiry-1",
          relation: "focused-inquiry",
          kind: "assistant",
          content: "这是追问解释",
          summary: "这是追问解释",
          status: "complete",
          createdAt: "2026-01-01T00:09:00.000Z",
          metadata: {},
        },
      ],
    };
    expect(getFocusedInquiryRoots(snapshot, "node-2", "timeline-main").map((node) => node.id)).toEqual(["inquiry-1"]);
    expect(getInquiryTree(snapshot, "inquiry-1").map((node) => node.id)).toEqual(["inquiry-1", "inquiry-2"]);
    expect(getLastNode(snapshot, "timeline-main")?.id).toBe("other-1");
  });
});

describe("searchWorkspace", () => {
  it("finds node matches across conversations and reports total counts", () => {
    const snapshot: WorkspaceSnapshot = {
      ...testWorkspace,
      conversations: [
        ...testWorkspace.conversations,
        {
          id: "conversation-other",
          title: "部署盘面",
          summary: "",
          color: "#4b67b0",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      nodes: [
        ...testWorkspace.nodes,
        {
          id: "deploy-1",
          timelineId: "timeline-deploy",
          kind: "user",
          content: "branch 部署计划怎么安排",
          summary: "部署计划怎么安排",
          status: "complete",
          createdAt: "2026-01-02T00:01:00.000Z",
          metadata: {},
        },
      ],
      timelines: [
        ...testWorkspace.timelines,
        {
          id: "timeline-deploy",
          conversationId: "conversation-other",
          name: "部署主线",
          contextMode: "until-node",
          status: "active",
          color: "#4b67b0",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    };
    const results = searchWorkspace(snapshot, "branch");
    expect(results.nodes.map((match) => match.node.id)).toContain("branch-1");
    expect(results.nodes.map((match) => match.node.id)).toContain("deploy-1");
    expect(results.totalNodeMatches).toBeGreaterThanOrEqual(3);
    expect(results.conversations).toHaveLength(0);
    expect(results.timelines).toHaveLength(0);
  });

  it("matches conversation titles and timeline names", () => {
    const results = searchWorkspace(testWorkspace, "测试");
    expect(results.conversations.map((match) => match.conversation.id)).toEqual(["conversation-test"]);
    expect(results.timelines).toHaveLength(0);

    const timelineResults = searchWorkspace(testWorkspace, "分支");
    expect(timelineResults.timelines.map((match) => match.timeline.id)).toEqual(["timeline-branch"]);
  });

  it("limits node search to the current conversation when scope is current", () => {
    const snapshot: WorkspaceSnapshot = {
      ...testWorkspace,
      currentConversationId: "conversation-test",
      nodes: [
        ...testWorkspace.nodes,
        {
          id: "outside-1",
          timelineId: "timeline-outside",
          kind: "user",
          content: "branch 里的外部节点",
          summary: "",
          status: "complete",
          createdAt: "2026-01-03T00:00:00.000Z",
          metadata: {},
        },
      ],
      timelines: [
        ...testWorkspace.timelines,
        {
          id: "timeline-outside",
          conversationId: "conversation-outside",
          name: "外部线",
          contextMode: "until-node",
          status: "active",
          color: "#ce6d39",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      conversations: [
        ...testWorkspace.conversations,
        {
          id: "conversation-outside",
          title: "外部对话",
          summary: "",
          color: "#ce6d39",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    };
    const ids = searchNodes(snapshot, "branch", { scope: "current" }).map((match) => match.node.id);
    expect(ids).toContain("branch-1");
    expect(ids).not.toContain("outside-1");

    const allIds = searchNodes(snapshot, "branch").map((match) => match.node.id);
    expect(allIds).toContain("outside-1");
  });

  it("prefers content matches over reasoning matches and ranks earlier matches first", () => {
    const snapshot: WorkspaceSnapshot = {
      ...testWorkspace,
      nodes: [
        ...testWorkspace.nodes,
        {
          id: "reasoning-1",
          timelineId: "timeline-main",
          kind: "assistant",
          content: "结论内容没有关键词",
          summary: "",
          status: "complete",
          createdAt: "2026-01-04T00:00:00.000Z",
          metadata: { reasoning: "思考过程中提到 branch 这个词" },
        },
        {
          id: "late-match",
          timelineId: "timeline-main",
          kind: "assistant",
          content: "很长的一段铺垫之后才出现 branch",
          summary: "",
          status: "complete",
          createdAt: "2026-01-05T00:00:00.000Z",
          metadata: {},
        },
      ],
    };
    const ids = searchNodes(snapshot, "branch").map((match) => match.node.id);
    const earlyMatch = ids.indexOf("branch-1");
    const lateMatch = ids.indexOf("late-match");
    const reasoningMatch = ids.indexOf("reasoning-1");
    expect(earlyMatch).toBeGreaterThanOrEqual(0);
    expect(lateMatch).toBeGreaterThan(earlyMatch);
    expect(reasoningMatch).toBeGreaterThan(lateMatch);
    const reasoningResult = searchNodes(snapshot, "branch").find((match) => match.node.id === "reasoning-1");
    expect(reasoningResult?.matchedField).toBe("reasoning");
  });

  it("returns empty results for blank queries", () => {
    expect(searchNodes(testWorkspace, "   ")).toEqual([]);
    const results = searchWorkspace(testWorkspace, "");
    expect(results.nodes).toEqual([]);
    expect(results.conversations).toEqual([]);
    expect(results.timelines).toEqual([]);
    expect(results.totalNodeMatches).toBe(0);
  });

  it("extracts a snippet centred on the first match with ellipsis markers", () => {
    const text =
      "在片段之前需要超过二十四个字符的铺垫内容才能看到省略号，中间出现了branch关键词，后面还有一段收尾";
    const snippet = extractMatchSnippet(text, "branch");
    expect(snippet.match).toBe("branch");
    expect(snippet.before.endsWith("中间出现了")).toBe(true);
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.startsWith("关键词")).toBe(true);

    const early = extractMatchSnippet("branch 开头匹配", "branch");
    expect(early.before).toBe("");
    expect(early.before).not.toContain("…");
  });
});
