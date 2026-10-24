import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../src/infrastructure/workspace.store.js";

describe("WorkspaceStore", () => {
  it("creates a conversation with a default timeline and replays idempotent writes", () => {
    const store = new WorkspaceStore();
    const first = store.createConversation("产品方向", "mutation-1");
    const replay = store.createConversation("产品方向", "mutation-1");

    expect(replay).toEqual(first);
    expect(store.listConversations()).toHaveLength(1);
    const graph = store.getGraph(first.id);
    expect(graph.timelines).toHaveLength(1);
    expect(graph.timelines[0]?.name).toBe("主线");
  });

  it("streams an explicit model gateway failure instead of a fake assistant answer", async () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("流式测试");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");

    const turn = store.createTurn(timeline.id, { content: "请继续", clientMessageId: "client-node-1" });
    const events = [];
    for await (const event of store.readTurnEvents(turn.turnId)) events.push(event);

    expect(events[0]?.event).toBe("message.started");
    expect(events.at(-1)?.event).toBe("message.failed");
    expect(events.map((event) => event.id)).toEqual([...events].sort((a, b) => a.id - b.id).map((event) => event.id));
    const graph = store.getGraph(conversation.id);
    const assistant = graph.nodes.find((node) => node.id === turn.assistantMessage.id);
    expect(assistant?.status).toBe("failed");
    expect(assistant?.content).toContain("HTTP 503");
  });

  it("keeps attachment reads scoped to the turn allow-list and supports paging", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("附件工具");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const turn = store.createTurn(timeline.id, {
      content: "读取附件",
      clientMessageId: "attachment-tool-turn",
      attachments: [{ id: "file-1", name: "notes.md", mimeType: "text/markdown", size: 14, textContent: "abcdefghijklmn" }],
    });
    expect(store.readTurnAttachment(turn.turnId, "file-1", 2, 4).text).toBe("cdef");
    expect(() => store.readTurnAttachment(turn.turnId, "other-file")).toThrow();
  });

  it("forks from a visible node and preserves inherited context", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("分支测试");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const firstTurn = store.createTurn(timeline.id, { content: "第一条", clientMessageId: "client-node-2" });
    const branch = store.forkFromMessage(firstTurn.userMessage.id, { contextMode: "until-node", name: "实验分支" });
    const context = store.getContext(branch.id);

    expect(branch.parentTimelineId).toBe(timeline.id);
    expect(context.nodes.map((node) => node.id)).toContain(firstTurn.userMessage.id);
    expect(context.inheritedNodeCount).toBeGreaterThan(0);
  });

  it("replays threat resolution without incrementing its version twice", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("风险测试", "conversation-risk");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const turn = store.createTurn(
      timeline.id,
      { content: "检查发布风险", clientMessageId: "client-node-risk" },
      "turn-risk",
    );
    const threat = store.createThreat({
      conversationId: conversation.id,
      nodeId: turn.userMessage.id,
      title: "打包失败",
      severity: "high",
    }, "create-threat");

    const first = store.resolveThreat(threat.id, "补齐构建验证", 1, "resolve-threat");
    const replay = store.resolveThreat(threat.id, "补齐构建验证", 1, "resolve-threat");

    expect(replay).toEqual(first);
    expect(replay.version).toBe(2);
  });

  it("persists focused inquiry metadata on the turn root and keeps it in the graph", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("选区追问测试");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const source = store.createTurn(timeline.id, { content: "解释这个专有名词", clientMessageId: "client-node-source" });

    const inquiry = store.createTurn(timeline.id, {
      content: "它在这里具体指什么？",
      clientMessageId: "client-node-inquiry",
      parentNodeId: source.assistantMessage.id,
      relation: "focused-inquiry",
      focusSelection: {
        sourceNodeId: source.assistantMessage.id,
        text: "专有名词",
        start: 3,
        end: 8,
        contentHash: "811c9dc5",
      },
    });

    expect(inquiry.userMessage.relation).toBe("focused-inquiry");
    expect(inquiry.userMessage.focusSelection?.sourceNodeId).toBe(source.assistantMessage.id);
    expect(store.getGraph(conversation.id).nodes.find((node) => node.id === inquiry.userMessage.id)?.focusSelection?.text).toBe("专有名词");
  });

  it("accepts only same-tree parents and normalizes continuation selection data", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("追问树校验");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const source = store.createTurn(timeline.id, { content: "来源", clientMessageId: "tree-source" });
    const selection = { sourceNodeId: source.assistantMessage.id, text: "来源", contentHash: "811c9dc5" };
    const root = store.createTurn(timeline.id, {
      content: "根问题", clientMessageId: "tree-root", parentNodeId: source.assistantMessage.id,
      relation: "focused-inquiry", inquiryRootId: "tree-root", focusSelection: selection,
    });
    const continuation = store.createTurn(timeline.id, {
      content: "继续问题", clientMessageId: "tree-follow-up", parentNodeId: root.assistantMessage.id,
      relation: "focused-inquiry", inquiryRootId: root.userMessage.id,
    });

    expect(continuation.userMessage.inquiryRootId).toBe(root.userMessage.id);
    expect(continuation.userMessage.focusSelection).toBeUndefined();
    expect(() => store.createTurn(timeline.id, {
      content: "串树问题", clientMessageId: "tree-cross", parentNodeId: root.assistantMessage.id,
      relation: "focused-inquiry", inquiryRootId: "another-root", focusSelection: selection,
    })).toThrow();
  });

  it("rejects a selection snapshot when the source message version changed", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("陈旧选区");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const source = store.createTurn(timeline.id, { content: "来源", clientMessageId: "stale-source" });
    expect(() => store.createTurn(timeline.id, {
      content: "陈旧追问", clientMessageId: "stale-inquiry", parentNodeId: source.assistantMessage.id,
      relation: "focused-inquiry", focusSelection: {
        sourceNodeId: source.assistantMessage.id, text: "来源", contentHash: "00000000",
      },
    })).toThrow();
  });

  it("builds isolated mainline and inquiry-tree context", () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("追问上下文");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const source = store.createTurn(timeline.id, { content: "主线问题", clientMessageId: "context-source" });
    const selection = { sourceNodeId: source.assistantMessage.id, text: "主线", contentHash: "811c9dc5" };
    const root = store.createTurn(timeline.id, {
      content: "第一个追问", clientMessageId: "context-root", parentNodeId: source.assistantMessage.id,
      relation: "focused-inquiry", focusSelection: selection,
    });
    const followUp = store.createTurn(timeline.id, {
      content: "第二个追问", clientMessageId: "context-follow-up", parentNodeId: root.assistantMessage.id,
      relation: "focused-inquiry", inquiryRootId: root.userMessage.id,
    });
    const context = store.getTurnContext(followUp.turnId);

    expect(context.messages.at(-1)).toMatchObject({ role: "user", content: "第二个追问" });
    expect(context.messages.some((message) => message.content.includes("主线"))).toBe(true);
    expect(context.messages.some((message) => message.content === "第一个追问")).toBe(true);
    expect(context.messages.some((message) => message.content === "第二个追问")).toBe(true);
    expect(context.messages.filter((message) => message.content === "另一个追问")).toHaveLength(0);
  });

  it("replays concurrent SSE readers without duplicating the assistant state", async () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("并发流");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const turn = store.createTurn(timeline.id, { content: "并发", clientMessageId: "concurrent-turn" });
    const read = async () => {
      const events = [];
      for await (const event of store.readTurnEvents(turn.turnId)) events.push(event);
      return events;
    };
    const [first, second] = await Promise.all([read(), read()]);
    const deltas = first.filter((event) => event.event === "message.delta").map((event) => String(event.data.delta)).join("");
    const graph = store.getGraph(conversation.id);
    const assistant = graph.nodes.find((node) => node.id === turn.assistantMessage.id);
    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(assistant?.content).toBe(deltas);
    expect(assistant?.status).toBe("failed");
  });

  it("finishes a cancelled turn and supports Last-Event-ID replay", async () => {
    const store = new WorkspaceStore();
    const conversation = store.createConversation("取消生成");
    const timeline = store.getGraph(conversation.id).timelines[0];
    if (!timeline) throw new Error("default timeline missing");
    const turn = store.createTurn(timeline.id, { content: "取消", clientMessageId: "cancel-turn" });
    const cancelled = store.cancelTurn(turn.turnId);
    expect(cancelled.status).toBe("failed");
    const events = [];
    for await (const event of store.readTurnEvents(turn.turnId, 2)) events.push(event);
    expect(events.every((event) => event.id > 2)).toBe(true);
    expect(events.at(-1)?.event).toBe("message.failed");
    expect(String(events.at(-1)?.data.error)).toContain("TURN_CANCELLED");
  });
});
