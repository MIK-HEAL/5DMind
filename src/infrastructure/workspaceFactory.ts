import type { WorkspaceSnapshot } from "../domain/types";

const WORKSPACE_COLOR = "#206b5a";

/** Creates the first usable local workspace without inserting demo messages. */
export function createEmptyWorkspace(): WorkspaceSnapshot {
  const now = new Date().toISOString();
  const conversationId = `conversation-${crypto.randomUUID()}`;
  const timelineId = `timeline-${crypto.randomUUID()}`;

  return {
    version: 1,
    conversations: [{
      id: conversationId,
      title: "新的工作区",
      summary: "从第一条消息开始建立时间线",
      color: WORKSPACE_COLOR,
      createdAt: now,
      updatedAt: now,
    }],
    timelines: [{
      id: timelineId,
      conversationId,
      name: "主线",
      contextMode: "until-node",
      status: "active",
      color: WORKSPACE_COLOR,
      createdAt: now,
      updatedAt: now,
    }],
    nodes: [],
    threats: [],
    references: [],
    currentConversationId: conversationId,
    currentTimelineId: timelineId,
  };
}
