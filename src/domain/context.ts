import type { MessageAttachment } from "./attachments";
import { getTimelineNodes, isFocusedInquiry } from "./selectors";
import type { ConversationNode, FocusSelection, WorkspaceSnapshot } from "./types";

export const MAX_CONTEXT_MESSAGES = 80;
export const MAX_CONTEXT_CHARS = 120_000;

export interface ContextPreviewMessage {
  role: "system" | "user" | "assistant";
  content: string;
  sourceNodeId?: string;
  kind: "system" | "history" | "current";
}

export interface ContextPreviewInput {
  timelineId: string;
  content: string;
  instructions?: string;
  relation?: ConversationNode["relation"];
  inquiryRootId?: string;
  parentNodeId?: string;
  focusSelection?: FocusSelection;
  attachments?: MessageAttachment[];
  webSearch?: boolean;
}

export function getConversationHistory(
  snapshot: WorkspaceSnapshot,
  input: Pick<ContextPreviewInput, "timelineId" | "relation" | "inquiryRootId" | "parentNodeId">,
) {
  const nodes = getTimelineNodes(snapshot, input.timelineId);
  const turns: Array<ContextPreviewMessage> = [];
  const appendNode = (node: ConversationNode) => {
    if (isFocusedInquiry(node) || (node.kind !== "user" && node.kind !== "assistant") || node.status !== "complete")
      return;
    const content = node.content.trim();
    if (!content) return;
    turns.push({ role: node.kind, content, sourceNodeId: node.id, kind: "history" });
  };
  nodes.forEach(appendNode);

  if (input.relation === "focused-inquiry" && input.inquiryRootId && input.parentNodeId) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const inquiryPath: ConversationNode[] = [];
    let current = nodesById.get(input.parentNodeId);
    const visited = new Set<string>();
    while (current && current.id !== input.inquiryRootId && !visited.has(current.id)) {
      visited.add(current.id);
      if (isFocusedInquiry(current)) inquiryPath.unshift(current);
      current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined;
    }
    if (current?.id === input.inquiryRootId) inquiryPath.unshift(current);
    inquiryPath.forEach(appendNode);
  }

  const selected: ContextPreviewMessage[] = [];
  let characters = 0;
  for (const turn of turns.slice(-MAX_CONTEXT_MESSAGES).reverse()) {
    const nextCharacters = characters + turn.content.length;
    if (selected.length > 0 && nextCharacters > MAX_CONTEXT_CHARS) break;
    selected.push(turn);
    characters = nextCharacters;
  }
  return selected.reverse();
}

function currentMessageContent(input: ContextPreviewInput) {
  const content = input.content.trim();
  const selected = input.focusSelection
    ? `请围绕以下消息选区回答追问：\n\n> ${input.focusSelection.text.replace(/\n/g, "\n> ")}\n\n${content}`
    : content;
  if (!input.attachments?.length) return selected;
  const attachmentContext = input.attachments
    .map((file) => {
      if (file.textContent !== undefined) return `- ${file.name} [${file.mimeType}]:\n${file.textContent}`;
      if (file.mimeType.startsWith("image/") && file.dataUrl)
        return `- ${file.name} [${file.mimeType}]（图片已作为视觉内容附加）`;
      return `- ${file.name} [${file.mimeType}] (${file.size} bytes; 可用附件句柄读取)`;
    })
    .join("\n");
  return `${selected}\n\n本轮附件（仅使用用户明确附加的文件）：\n${attachmentContext}`;
}

export function buildContextPreview(snapshot: WorkspaceSnapshot, input: ContextPreviewInput): ContextPreviewMessage[] {
  const messages: ContextPreviewMessage[] = [];
  const instructions = input.instructions?.trim();
  messages.push({
    role: "system",
    content: `${instructions || "（未设置系统提示词）"}${input.webSearch ? "\n\n（联网检索上下文将在发送时附加）" : ""}`,
    kind: "system",
  });
  messages.push(...getConversationHistory(snapshot, input));
  messages.push({
    role: "user",
    content: currentMessageContent(input) || "（发送时填入当前输入）",
    kind: "current",
  });
  return messages;
}
