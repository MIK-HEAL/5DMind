import { describe, expect, it } from "vitest";
import type { ConversationNode, WorkspaceSnapshot } from "../domain/types";
import {
  activateConversation,
  activateTimeline,
  appendConversation,
  appendManualReference,
  appendMergeSummary,
  appendThreat,
  applyMessageEvent,
  buildFailedReplyNode,
  closeInquiryWindow,
  forkTimeline,
  removeConversationCascade,
  removeMessageCascade,
  renameConversationById,
  resolveThreatById,
  revealNode,
  toggleCompareId,
} from "./workspaceReducers";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:01:00.000Z";
const T2 = "2026-01-01T00:02:00.000Z";

function makeNode(
  partial: Partial<ConversationNode> & Pick<ConversationNode, "id" | "timelineId" | "kind" | "content">,
): ConversationNode {
  return {
    parentNodeId: undefined,
    summary: partial.content.slice(0, 44),
    status: "complete",
    createdAt: T0,
    metadata: {},
    ...partial,
  };
}

function makeWorkspace(): WorkspaceSnapshot {
  return {
    version: 1,
    currentConversationId: "conversation-test",
    currentTimelineId: "timeline-main",
    conversations: [
      {
        id: "conversation-test",
        title: "测试工作区",
        summary: "",
        color: "#206b5a",
        createdAt: T0,
        updatedAt: T0,
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
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: "timeline-branch",
        conversationId: "conversation-test",
        name: "方案B",
        parentTimelineId: "timeline-main",
        forkedFromNodeId: "node-main-1",
        contextMode: "until-node",
        status: "active",
        color: "#4b67b0",
        createdAt: T1,
        updatedAt: T1,
      },
    ],
    nodes: [
      makeNode({ id: "node-main-1", timelineId: "timeline-main", kind: "user", content: "问题是什么", createdAt: T0 }),
      makeNode({
        id: "node-main-2",
        timelineId: "timeline-main",
        parentNodeId: "node-main-1",
        kind: "assistant",
        content: "主线回答",
        createdAt: T1,
      }),
      makeNode({
        id: "node-branch-1",
        timelineId: "timeline-branch",
        kind: "assistant",
        content: "分支结论",
        summary: "分支独立结论",
        createdAt: T2,
      }),
      makeNode({
        id: "inquiry-root",
        timelineId: "timeline-main",
        parentNodeId: "node-main-2",
        relation: "focused-inquiry",
        inquiryRootId: "inquiry-root",
        focusSelection: { sourceNodeId: "node-main-2", text: "主线回答", contentHash: "hash-1" },
        kind: "user",
        content: "为什么",
        createdAt: T2,
      }),
    ],
    threats: [
      {
        id: "threat-1",
        conversationId: "conversation-test",
        nodeId: "node-main-2",
        title: "风险一",
        detail: "细节",
        severity: "high",
        status: "open",
        createdAt: T1,
      },
    ],
    references: [
      {
        id: "ref-1",
        sourceNodeId: "node-main-1",
        targetNodeId: "node-branch-1",
        label: "手动引用",
        createdAt: T2,
      },
    ],
  };
}

describe("activateConversation / activateTimeline", () => {
  it("switches to the active timeline of the target conversation", () => {
    const next = activateConversation(makeWorkspace(), "conversation-test");
    expect(next.currentTimelineId).toBe("timeline-main");
    expect(next.currentConversationId).toBe("conversation-test");
  });

  it("returns the same reference when the conversation does not exist", () => {
    const workspace = makeWorkspace();
    expect(activateConversation(workspace, "conversation-missing")).toBe(workspace);
  });

  it("activates the requested timeline and its conversation", () => {
    const next = activateTimeline(makeWorkspace(), "timeline-branch");
    expect(next.currentTimelineId).toBe("timeline-branch");
    expect(next.currentConversationId).toBe("conversation-test");
  });

  it("returns the same reference for an unknown timeline", () => {
    const workspace = makeWorkspace();
    expect(activateTimeline(workspace, "timeline-missing")).toBe(workspace);
  });
});

describe("revealNode", () => {
  it("keeps the current timeline when the node is already visible", () => {
    const workspace = makeWorkspace();
    expect(revealNode(workspace, "node-main-1")).toBe(workspace);
  });

  it("switches to the timeline owning the node when it is not visible", () => {
    const next = revealNode(makeWorkspace(), "node-branch-1");
    expect(next.currentTimelineId).toBe("timeline-branch");
  });

  it("returns the same reference for an unknown node", () => {
    const workspace = makeWorkspace();
    expect(revealNode(workspace, "node-missing")).toBe(workspace);
  });
});

describe("toggleCompareId", () => {
  it("adds the first timeline", () => {
    expect(toggleCompareId([], "timeline-main")).toEqual(["timeline-main"]);
  });

  it("keeps at most two timelines, dropping the oldest", () => {
    expect(toggleCompareId(["timeline-main", "timeline-branch"], "timeline-third")).toEqual([
      "timeline-branch",
      "timeline-third",
    ]);
  });

  it("removes a timeline that is already selected", () => {
    expect(toggleCompareId(["timeline-main", "timeline-branch"], "timeline-main")).toEqual(["timeline-branch"]);
  });
});

describe("closeInquiryWindow", () => {
  it("moves focus to the last remaining inquiry when the active one belonged to the closed window", () => {
    const workspace = makeWorkspace();
    const result = closeInquiryWindow(workspace, ["inquiry-root", "inquiry-other"], "inquiry-root", "inquiry-root");
    expect(result.openIds).toEqual(["inquiry-other"]);
    expect(result.updateFocus).toBe(true);
    expect(result.focusedInquiryId).toBe("inquiry-other");
  });

  it("keeps focus untouched when the active inquiry is outside the closed window", () => {
    const workspace = makeWorkspace();
    const result = closeInquiryWindow(workspace, ["inquiry-root"], "inquiry-root", "node-main-1");
    expect(result.openIds).toEqual([]);
    expect(result.updateFocus).toBe(false);
    expect(result.focusedInquiryId).toBe("node-main-1");
  });
});

describe("forkTimeline", () => {
  it("creates a branch timeline with fallback name and fork metadata", () => {
    const next = forkTimeline(makeWorkspace(), {
      nodeId: "node-main-1",
      name: "",
      contextMode: "all",
      timelineId: "timeline-fork",
      now: T2,
    });
    const timeline = next.timelines.find((item) => item.id === "timeline-fork");
    expect(timeline).toMatchObject({
      conversationId: "conversation-test",
      name: "分支 · 问题是什么",
      parentTimelineId: "timeline-main",
      forkedFromNodeId: "node-main-1",
      contextMode: "all",
      status: "active",
      color: "#7a5ba6",
    });
    expect(next.currentTimelineId).toBe("timeline-fork");
  });

  it("returns the same reference when the source node does not exist", () => {
    const workspace = makeWorkspace();
    const next = forkTimeline(workspace, {
      nodeId: "node-missing",
      name: "x",
      contextMode: "all",
      timelineId: "timeline-fork",
      now: T2,
    });
    expect(next).toBe(workspace);
  });
});

describe("threat reducers", () => {
  it("appends a threat", () => {
    const threat = {
      id: "threat-2",
      conversationId: "conversation-test",
      nodeId: "node-main-1",
      title: "新风险",
      detail: "",
      severity: "medium" as const,
      status: "open" as const,
      createdAt: T2,
    };
    const next = appendThreat(makeWorkspace(), threat);
    expect(next.threats).toHaveLength(2);
    expect(next.threats.at(-1)).toEqual(threat);
  });

  it("resolves a threat with resolution and timestamp", () => {
    const next = resolveThreatById(makeWorkspace(), "threat-1", "已处理", T2);
    const threat = next.threats.find((item) => item.id === "threat-1");
    expect(threat).toMatchObject({ status: "resolved", resolution: "已处理", resolvedAt: T2 });
  });
});

describe("appendManualReference", () => {
  it("creates a reference node copying the source content and a link", () => {
    const next = appendManualReference(makeWorkspace(), {
      sourceNodeId: "node-main-1",
      nodeId: "node-ref",
      referenceId: "ref-2",
      now: T2,
    });
    const node = next.nodes.find((item) => item.id === "node-ref");
    expect(node).toMatchObject({
      kind: "reference",
      content: "问题是什么",
      summary: "引用：问题是什么",
      timelineId: "timeline-main",
      sourceNodeIds: ["node-main-1"],
      metadata: { boardName: "测试工作区", tags: ["显式引用"] },
    });
    expect(next.references.at(-1)).toMatchObject({
      id: "ref-2",
      sourceNodeId: "node-main-1",
      targetNodeId: "node-ref",
      label: "手动引用",
    });
  });

  it("returns the same reference when the source node does not exist", () => {
    const workspace = makeWorkspace();
    const next = appendManualReference(workspace, {
      sourceNodeId: "node-missing",
      nodeId: "node-ref",
      referenceId: "ref-2",
      now: T2,
    });
    expect(next).toBe(workspace);
  });
});

describe("appendMergeSummary", () => {
  it("summarizes the last node of each compared timeline and keeps source traceability", () => {
    const workspace = makeWorkspace();
    const next = appendMergeSummary(workspace, ["timeline-main", "timeline-branch"], "node-merge", T2);
    const node = next.nodes.find((item) => item.id === "node-merge");
    expect(node?.kind).toBe("merge");
    expect(node?.content).toContain("主线：为什么");
    expect(node?.content).toContain("方案B：分支独立结论");
    expect(node?.summary).toBe("合并两条分支的比较结论");
    expect(node?.sourceNodeIds).toEqual(expect.arrayContaining(["node-main-1", "node-main-2", "node-branch-1"]));
  });
});

describe("renameConversationById", () => {
  it("renames the conversation and bumps updatedAt", () => {
    const next = renameConversationById(makeWorkspace(), "conversation-test", "新名字", T2);
    expect(next.conversations[0]).toMatchObject({ title: "新名字", updatedAt: T2 });
  });
});

describe("removeConversationCascade", () => {
  it("refuses to remove the last remaining conversation", () => {
    const workspace = makeWorkspace();
    expect(removeConversationCascade(workspace, "conversation-test")).toBe(workspace);
  });

  it("removes the conversation with its timelines, nodes, threats and references, then retargets", () => {
    const workspace = makeWorkspace();
    workspace.conversations.push({
      id: "conversation-second",
      title: "第二工作区",
      summary: "",
      color: "#7a5ba6",
      createdAt: T1,
      updatedAt: T1,
    });
    workspace.timelines.push({
      id: "timeline-second",
      conversationId: "conversation-second",
      name: "主线",
      contextMode: "until-node",
      status: "active",
      color: "#7a5ba6",
      createdAt: T1,
      updatedAt: T1,
    });
    workspace.nodes.push(
      makeNode({
        id: "node-second-1",
        timelineId: "timeline-second",
        kind: "user",
        content: "第二工作区消息",
        createdAt: T1,
      }),
    );
    workspace.threats.push({
      id: "threat-second",
      conversationId: "conversation-second",
      nodeId: "node-second-1",
      title: "第二风险",
      detail: "",
      severity: "low",
      status: "open",
      createdAt: T1,
    });

    const next = removeConversationCascade(workspace, "conversation-test");
    expect(next.conversations.map((item) => item.id)).toEqual(["conversation-second"]);
    expect(next.timelines.map((item) => item.id)).toEqual(["timeline-second"]);
    expect(next.nodes.map((item) => item.id)).toEqual(["node-second-1"]);
    expect(next.threats.map((item) => item.id)).toEqual(["threat-second"]);
    expect(next.references).toEqual([]);
    expect(next.currentConversationId).toBe("conversation-second");
    expect(next.currentTimelineId).toBe("timeline-second");
  });
});

describe("removeMessageCascade", () => {
  it("removes the message subtree scoped to its own timeline plus related threats and references", () => {
    const next = removeMessageCascade(makeWorkspace(), "node-main-1");
    // node-main-2 and inquiry-root hang under node-main-1 on the same timeline;
    // node-branch-1 lives on the branch timeline and survives.
    expect(next.nodes.map((item) => item.id).sort()).toEqual(["node-branch-1"]);
    expect(next.threats).toEqual([]);
    expect(next.references).toEqual([]);
  });

  it("returns the same reference for an unknown message", () => {
    const workspace = makeWorkspace();
    expect(removeMessageCascade(workspace, "node-missing")).toBe(workspace);
  });
});

describe("appendConversation", () => {
  it("creates a conversation with a main timeline and activates it", () => {
    const next = appendConversation(makeWorkspace(), {
      conversationId: "conversation-new",
      timelineId: "timeline-new",
      title: "新工作区",
      now: T2,
    });
    expect(next.conversations.at(-1)).toMatchObject({ id: "conversation-new", title: "新工作区" });
    expect(next.timelines.at(-1)).toMatchObject({
      id: "timeline-new",
      conversationId: "conversation-new",
      name: "主线",
      status: "active",
    });
    expect(next.currentConversationId).toBe("conversation-new");
    expect(next.currentTimelineId).toBe("timeline-new");
  });
});

describe("applyMessageEvent", () => {
  const baseContext = {
    parentNodeId: "node-main-1",
    author: "助手",
    model: "model-x",
    completedSummary: "本地回复",
  };

  it("attaches a started assistant message with author/model metadata", () => {
    const workspace = makeWorkspace();
    const event = {
      type: "message.started" as const,
      message: makeNode({
        id: "node-answer",
        timelineId: "timeline-main",
        kind: "assistant",
        content: "",
        status: "streaming",
      }),
    };
    const next = applyMessageEvent(workspace, event, baseContext);
    const node = next.nodes.find((item) => item.id === "node-answer");
    expect(node?.parentNodeId).toBe("node-main-1");
    expect(node?.metadata).toMatchObject({ author: "助手", model: "model-x" });
  });

  it("appends inquiry relation, root and tags in inquiry context", () => {
    const workspace = makeWorkspace();
    const event = {
      type: "message.started" as const,
      message: makeNode({
        id: "node-answer",
        timelineId: "timeline-main",
        kind: "assistant",
        content: "",
        status: "streaming",
      }),
    };
    const next = applyMessageEvent(workspace, event, {
      ...baseContext,
      relation: "focused-inquiry",
      inquiryRootId: "inquiry-root",
      tags: ["选区追问"],
    });
    const node = next.nodes.find((item) => item.id === "node-answer");
    expect(node).toMatchObject({ relation: "focused-inquiry", inquiryRootId: "inquiry-root" });
    expect(node?.metadata.tags).toEqual(["选区追问"]);
  });

  it("appends delta content and reasoning to the streamed node", () => {
    let workspace = makeWorkspace();
    const started = {
      type: "message.started" as const,
      message: makeNode({
        id: "node-answer",
        timelineId: "timeline-main",
        kind: "assistant",
        content: "",
        status: "streaming",
      }),
    };
    workspace = applyMessageEvent(workspace, started, baseContext);
    workspace = applyMessageEvent(
      workspace,
      { type: "message.delta", messageId: "node-answer", delta: "你好" },
      baseContext,
    );
    workspace = applyMessageEvent(
      workspace,
      { type: "message.reasoning_delta", messageId: "node-answer", delta: "想想" },
      baseContext,
    );
    const node = workspace.nodes.find((item) => item.id === "node-answer");
    expect(node?.content).toBe("你好");
    expect(node?.metadata.reasoning).toBe("想想");
  });

  it("marks the node complete with the context summary or failed with the error", () => {
    let workspace = makeWorkspace();
    const started = {
      type: "message.started" as const,
      message: makeNode({
        id: "node-answer",
        timelineId: "timeline-main",
        kind: "assistant",
        content: "答案",
        status: "streaming",
      }),
    };
    workspace = applyMessageEvent(workspace, started, baseContext);
    const completed = applyMessageEvent(
      workspace,
      { type: "message.completed", messageId: "node-answer" },
      baseContext,
    );
    expect(completed.nodes.find((item) => item.id === "node-answer")).toMatchObject({
      status: "complete",
      summary: "本地回复",
    });
    const failed = applyMessageEvent(
      workspace,
      { type: "message.failed", messageId: "node-answer", error: "网关超时" },
      baseContext,
    );
    expect(failed.nodes.find((item) => item.id === "node-answer")).toMatchObject({
      status: "failed",
      summary: "网关超时",
    });
  });
});

describe("buildFailedReplyNode", () => {
  it("builds a normal failed reply", () => {
    const node = buildFailedReplyNode({
      id: "node-failed",
      timelineId: "timeline-main",
      parentNodeId: "node-main-1",
      detail: "boom",
      author: "助手",
      model: undefined,
      now: T2,
    });
    expect(node).toMatchObject({
      kind: "assistant",
      status: "failed",
      summary: "回复失败",
      content: "无法生成回复\n\nboom",
      metadata: { author: "助手", model: "未配置模型" },
    });
    expect(node.relation).toBeUndefined();
  });

  it("builds an inquiry failed reply with relation, root and tags", () => {
    const node = buildFailedReplyNode({
      id: "node-failed",
      timelineId: "timeline-main",
      parentNodeId: "inquiry-root",
      detail: "boom",
      author: "助手",
      model: "model-x",
      inquiryRootId: "inquiry-root",
      now: T2,
    });
    expect(node).toMatchObject({
      relation: "focused-inquiry",
      inquiryRootId: "inquiry-root",
      summary: "追问回复失败",
      content: "无法生成追问回复\n\nboom",
      metadata: { author: "助手", model: "model-x", tags: ["选区追问"] },
    });
  });
});
