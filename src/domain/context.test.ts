import { describe, expect, it } from "vitest";
import { buildContextPreview, getConversationHistory } from "./context";
import type { WorkspaceSnapshot } from "./types";

const workspace: WorkspaceSnapshot = {
  version: 1,
  currentConversationId: "conversation-test",
  currentTimelineId: "timeline-main",
  conversations: [],
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
  ],
  nodes: [
    {
      id: "user-1",
      timelineId: "timeline-main",
      kind: "user",
      content: "先看事实",
      summary: "先看事实",
      status: "complete",
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    },
    {
      id: "assistant-1",
      timelineId: "timeline-main",
      parentNodeId: "user-1",
      kind: "assistant",
      content: "事实结论",
      summary: "事实结论",
      status: "complete",
      createdAt: "2026-01-01T00:01:00.000Z",
      metadata: {},
    },
    {
      id: "streaming-1",
      timelineId: "timeline-main",
      parentNodeId: "assistant-1",
      kind: "assistant",
      content: "未完成",
      summary: "未完成",
      status: "streaming",
      createdAt: "2026-01-01T00:02:00.000Z",
      metadata: {},
    },
  ],
  threats: [],
  references: [],
};

describe("context preview", () => {
  it("matches the bounded history sent to the model", () => {
    expect(getConversationHistory(workspace, { timelineId: "timeline-main" }).map((item) => item.content)).toEqual([
      "先看事实",
      "事实结论",
    ]);
  });

  it("includes system instructions, history, and the transformed current message", () => {
    const messages = buildContextPreview(workspace, {
      timelineId: "timeline-main",
      content: "解释这段",
      instructions: "保持简洁",
      focusSelection: { sourceNodeId: "assistant-1", text: "事实结论", contentHash: "hash" },
    });
    expect(messages.map((item) => item.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.at(-1)?.content).toContain("请围绕以下消息选区回答追问");
  });
});
