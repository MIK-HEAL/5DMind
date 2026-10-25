import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContextMode, ConversationNode, FocusSelection, Threat, WorkspaceSnapshot } from "../domain/types";
import type { ConversationService } from "../domain/services";
import type { AgentProfile, ReasoningEffort } from "../domain/settings";
import type { MessageAttachment } from "../domain/attachments";
import { attachmentMetadata } from "../domain/attachments";
import { getLastNode, getNode } from "../domain/selectors";
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
import { workspaceRepository } from "../infrastructure/workspaceRepository";
import { tauriWorkspaceRepository } from "../infrastructure/tauriWorkspaceRepository";
import { TauriConversationService } from "../infrastructure/tauriConversationService";
import { UnavailableConversationService } from "../infrastructure/unavailableConversationService";
import { HttpWorkspaceService } from "../infrastructure/httpWorkspaceService";
import { runtimeTarget, workspaceMode } from "../infrastructure/runtime";
import { createEmptyWorkspace } from "../infrastructure/workspaceFactory";
import { useSettings } from "./SettingsProvider";

type SaveStatus = "loading" | "saved" | "saving" | "error";

interface WorkspaceContextValue {
  snapshot: WorkspaceSnapshot;
  hydrated: boolean;
  saveStatus: SaveStatus;
  selectedNodeId?: string;
  focusedInquiryId?: string;
  focusedInquiryIds: string[];
  mapOpen: boolean;
  mapPinned: boolean;
  compareIds: string[];
  switchConversation: (conversationId: string) => void;
  switchTimeline: (timelineId: string) => void;
  selectNode: (nodeId?: string) => void;
  focusInquiry: (nodeId?: string) => void;
  openInquiry: (nodeId: string) => void;
  closeInquiry: (nodeId: string) => void;
  setMapOpen: (open: boolean) => void;
  setMapPinned: (pinned: boolean) => void;
  toggleCompare: (timelineId: string) => void;
  sendMessage: (
    content: string,
    options?: { reasoningEffort?: ReasoningEffort; webSearch?: boolean; instructions?: string; attachments?: MessageAttachment[] },
  ) => Promise<void>;
  generateAgentOpinions: (sourceNodeId: string, agentIds: string[]) => Promise<void>;
  createFocusedInquiry: (
    sourceNodeId: string,
    selection: FocusSelection,
    question: string,
    parentNodeId?: string,
    openWindow?: boolean,
  ) => Promise<string>;
  forkFromNode: (nodeId: string, name: string, contextMode: ContextMode) => Promise<string>;
  createThreat: (nodeId: string, title: string, detail: string, severity: Threat["severity"]) => Promise<void>;
  resolveThreat: (threatId: string) => Promise<void>;
  createReference: (sourceNodeId: string) => Promise<void>;
  createMergeSummary: () => Promise<void>;
  createConversation: (title: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  updateMessage: (messageId: string, content: string) => Promise<void>;
  editAndResendMessage: (messageId: string, content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  resetWorkspace: () => Promise<void>;
  exportWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function describeSendError(error: unknown): string {
  const candidate = error as { message?: string; code?: string; status?: number; requestId?: string; retryable?: boolean };
  const code = candidate.code ?? (error instanceof DOMException && error.name === "AbortError" ? "REQUEST_ABORTED" : "MODEL_GATEWAY_ERROR");
  const message = candidate.message ?? "模型服务未返回可用结果";
  const parts = [`错误码 ${code}`];
  if (typeof candidate.status === "number") parts.push(`HTTP ${candidate.status}`);
  if (candidate.requestId) parts.push(`请求 ID ${candidate.requestId}`);
  parts.push(candidate.retryable === false ? "不可重试" : "可重试");
  return `${parts.join(" · ")}：${message}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { activeAgent, preferences } = useSettings();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => createEmptyWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [focusedInquiryId, setFocusedInquiryId] = useState<string>();
  const [focusedInquiryIds, setFocusedInquiryIds] = useState<string[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPinned, setMapPinnedState] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const attachmentPayloadsRef = useRef(new Map<string, MessageAttachment[]>());
  const snapshotRef = useRef(snapshot);
  const remoteService = useMemo(() => new HttpWorkspaceService(), []);
  const localRepository = runtimeTarget === "desktop" ? tauriWorkspaceRepository : workspaceRepository;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const conversationService = useMemo<ConversationService>(
    () =>
      workspaceMode === "remote"
        ? remoteService
        : runtimeTarget === "desktop"
          ? new TauriConversationService(snapshotRef)
          : new UnavailableConversationService(snapshotRef),
    [remoteService],
  );
  const activeProvider = preferences.providers.find((provider) => provider.id === activeAgent.providerId);

  useEffect(() => {
    let active = true;
    const hydrate = workspaceMode === "remote" ? remoteService.hydrate() : localRepository.load();
    hydrate
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setHydrated(true);
        setSaveStatus("saved");
      })
      .catch(() => {
        if (!active) return;
        // Keep the UI usable when the configured API is unavailable. Local mode
        // remains the explicit fallback; remote writes still report their errors.
        setSnapshot(createEmptyWorkspace());
        setHydrated(true);
        setSaveStatus("error");
      });
    return () => {
      active = false;
    };
  }, [localRepository, remoteService]);

  useEffect(() => {
    if (!hydrated || workspaceMode === "remote") return;
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      localRepository
        .save(snapshot)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [localRepository, snapshot, hydrated]);

  const switchConversation = useCallback((conversationId: string) => {
    setSnapshot((current) => activateConversation(current, conversationId));
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
    setCompareIds([]);
  }, []);

  const switchTimeline = useCallback((timelineId: string) => {
    setSnapshot((current) => activateTimeline(current, timelineId));
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
  }, []);

  const selectNode = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setSelectedNodeId(undefined);
      return;
    }
    setSnapshot((current) => revealNode(current, nodeId));
    setSelectedNodeId(nodeId);
  }, []);

  const focusInquiry = useCallback((nodeId?: string) => {
    setFocusedInquiryId(nodeId);
  }, []);

  const openInquiry = useCallback((nodeId: string) => {
    setFocusedInquiryIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    setFocusedInquiryId(nodeId);
  }, []);

  const closeInquiry = useCallback(
    (nodeId: string) => {
      const result = closeInquiryWindow(snapshotRef.current, focusedInquiryIds, nodeId, focusedInquiryId);
      setFocusedInquiryIds(result.openIds);
      if (result.updateFocus) setFocusedInquiryId(result.focusedInquiryId);
    },
    [focusedInquiryId, focusedInquiryIds],
  );

  const setMapPinned = useCallback((pinned: boolean) => {
    setMapPinnedState(pinned);
    if (pinned) setMapOpen(true);
  }, []);

  const toggleCompare = useCallback((timelineId: string) => {
    setCompareIds((current) => toggleCompareId(current, timelineId));
  }, []);

  const authorizeTimelineTool = useCallback(
    (operation: string) => {
      if (!activeAgent.tools.timeline || activeAgent.permissionMode === "read-only") {
        throw new Error("当前 Agent 没有写入时间线的权限");
      }
      if (activeAgent.permissionMode === "ask" && !window.confirm(`Agent 请求${operation}，确认后才会写入时间线。`)) {
        throw new Error("已取消时间线操作");
      }
    },
    [activeAgent],
  );

  const sendMessageOnTimeline = useCallback(
    async (
      content: string,
      options?: { reasoningEffort?: ReasoningEffort; webSearch?: boolean; instructions?: string; attachments?: MessageAttachment[] },
      target?: { timelineId?: string; parentNodeId?: string; reuseUserNodeId?: string; agentId?: string; opinionGroupId?: string },
    ) => {
      const clean = content.trim();
      if (!clean) return;
      const timelineId = target?.timelineId ?? snapshotRef.current.currentTimelineId;
      const now = new Date().toISOString();
      const userId = makeId("node");
      if (options?.attachments?.length) attachmentPayloadsRef.current.set(userId, options.attachments);
      const respondingAgent: AgentProfile = target?.agentId
        ? preferences.agents.find((agent) => agent.id === target.agentId) ?? activeAgent
        : activeAgent;
      const respondingProvider = preferences.providers.find((provider) => provider.id === respondingAgent.providerId);
      const parentNodeId = target?.parentNodeId ?? getLastNode(snapshotRef.current, timelineId)?.id;
      const userNode: ConversationNode = {
        id: userId,
        timelineId,
        parentNodeId,
        kind: "user",
        content: clean,
        summary: clean.slice(0, 44),
        status: "complete",
        createdAt: now,
        metadata: {
          author: preferences.profileName.trim() || "你",
          ...(options?.attachments?.length
            ? { attachments: options.attachments.map(attachmentMetadata) }
            : {}),
        },
      };
      if (target?.reuseUserNodeId) {
        setSnapshot((current) => ({
          ...current,
          nodes: current.nodes.map((item) =>
            item.id === target.reuseUserNodeId
              ? { ...item, content: clean, summary: clean.slice(0, 44), status: "complete" as const }
              : item,
          ),
        }));
      } else {
        setSnapshot((current) => ({ ...current, nodes: [...current.nodes, userNode] }));
      }
      const displayUserId = target?.reuseUserNodeId ?? userId;
      setSelectedNodeId(displayUserId);

      const eventContext = {
        parentNodeId: displayUserId,
        author: respondingAgent.name,
        model: respondingAgent.modelId,
        agentId: respondingAgent.id,
        agentColor: respondingAgent.color,
        opinionGroupId: target?.opinionGroupId,
        completedSummary: workspaceMode === "remote" ? "云端回复" : "本地回复",
      } as const;
      try {
        for await (const event of conversationService.sendMessage({
          timelineId,
          content: clean,
          clientMessageId: userId,
          replaceMessageId: target?.reuseUserNodeId,
          parentNodeId,
          model: respondingAgent.modelId || undefined,
          providerId: respondingProvider?.id,
          providerType: respondingProvider?.type,
          baseUrl: respondingProvider?.baseUrl,
          apiPath: respondingProvider?.apiPath,
          requestTimeoutMs: respondingProvider?.requestTimeoutMs,
          instructions: options?.instructions?.trim() || respondingAgent.instructions,
          temperature: respondingAgent.temperature,
          reasoningEffort: options?.reasoningEffort ?? respondingAgent.reasoningEffort ?? "default",
          webSearch: options?.webSearch ?? respondingAgent.tools.webSearch,
          attachments: respondingAgent.tools.files ? options?.attachments : undefined,
        })) {
          setSnapshot((current) => applyMessageEvent(current, event, eventContext));
          if (event.type === "message.started") setSelectedNodeId(event.message.id);
        }
      } catch (error) {
        const detail = describeSendError(error);
        const failedId = makeId("node");
        setSnapshot((current) => ({
          ...current,
          nodes: [
            ...current.nodes,
            buildFailedReplyNode({
              id: failedId,
              timelineId,
              parentNodeId: displayUserId,
              detail,
              author: respondingAgent.name,
              model: respondingAgent.modelId || undefined,
              now: new Date().toISOString(),
            }),
          ],
        }));
        setSelectedNodeId(failedId);
      }
    },
    [activeAgent, conversationService, preferences.agents, preferences.profileName, preferences.providers],
  );

  const sendMessage = useCallback(
    (content: string, options?: { reasoningEffort?: ReasoningEffort; webSearch?: boolean; instructions?: string; attachments?: MessageAttachment[] }) =>
      sendMessageOnTimeline(content, options),
    [sendMessageOnTimeline],
  );

  const generateAgentOpinions = useCallback(
    async (sourceNodeId: string, agentIds: string[]) => {
      const source = snapshotRef.current.nodes.find((node) => node.id === sourceNodeId);
      const timelineId = snapshotRef.current.currentTimelineId;
      const selectedAgents = agentIds
        .map((id) => preferences.agents.find((agent) => agent.id === id))
        .filter((agent): agent is AgentProfile => Boolean(agent))
        .slice(0, 2);
      if (!source || !selectedAgents.length) return;
      const existingReview = snapshotRef.current.nodes.find(
        (node) => node.kind === "user" && node.parentNodeId === source.id && node.metadata.tags?.includes("意见对比"),
      );
      const opinionGroupId = existingReview?.metadata.opinionGroupId ?? makeId("opinions");
      const reviewNodeId = existingReview?.id ?? makeId("node");
      const now = new Date().toISOString();
      if (!existingReview) {
        const reviewNode: ConversationNode = {
          id: reviewNodeId,
          timelineId,
          parentNodeId: source.id,
          kind: "user",
          content: `多 Agent 复审：${source.summary}`,
          summary: `多 Agent 复审：${source.summary}`.slice(0, 44),
          status: "complete",
          createdAt: now,
          metadata: { author: preferences.profileName.trim() || "你", tags: ["意见对比"], opinionGroupId },
        };
        setSnapshot((current) => ({ ...current, nodes: [...current.nodes, reviewNode] }));
      }
      setSelectedNodeId(reviewNodeId);
      const prompt = `请从你的专业视角重审以下结论，明确指出支持证据、主要疑点和下一步行动：\n\n${source.content}`;
      for (const agent of selectedAgents) {
        await sendMessageOnTimeline(prompt, { instructions: agent.instructions, webSearch: agent.tools.webSearch }, {
          timelineId,
          parentNodeId: source.id,
          reuseUserNodeId: reviewNodeId,
          agentId: agent.id,
          opinionGroupId,
        });
      }
    },
    [preferences.agents, preferences.profileName, sendMessageOnTimeline],
  );

  const createFocusedInquiry = useCallback(
    async (
      sourceNodeId: string,
      selection: FocusSelection,
      question: string,
      parentNodeId = sourceNodeId,
      openWindow = true,
    ): Promise<string> => {
      const clean = question.trim();
      if (!clean) return "";
      const current = snapshotRef.current;
      const source = getNode(current, sourceNodeId);
      if (!source) return "";
      const timelineId = current.currentTimelineId;
      const userId = makeId("inquiry");
      const parentNode = parentNodeId === sourceNodeId ? undefined : getNode(current, parentNodeId);
      const inquiryRootId = parentNode?.inquiryRootId ?? userId;
      const isRootInquiry = parentNodeId === sourceNodeId;
      const now = new Date().toISOString();
      const userNode: ConversationNode = {
        id: userId,
        timelineId,
        parentNodeId,
        relation: "focused-inquiry",
        inquiryRootId,
        ...(isRootInquiry ? { focusSelection: selection } : {}),
        kind: "user",
        content: clean,
        summary: clean.slice(0, 44),
        status: "complete",
        createdAt: now,
        metadata: { author: preferences.profileName.trim() || "你", tags: ["选区追问"] },
      };
      setSnapshot((state) => ({ ...state, nodes: [...state.nodes, userNode] }));
      if (openWindow) openInquiry(userId);
      else setFocusedInquiryId(userId);
      setSelectedNodeId(userId);

      const eventContext = {
        parentNodeId: userId,
        author: activeAgent.name,
        model: activeAgent.modelId,
        relation: "focused-inquiry" as const,
        inquiryRootId,
        tags: ["选区追问"],
        completedSummary: workspaceMode === "remote" ? "云端追问回复" : "追问回复",
      };
      try {
        for await (const event of conversationService.sendMessage({
          timelineId,
          content: clean,
          clientMessageId: userId,
          parentNodeId,
          inquiryRootId,
          relation: "focused-inquiry",
          focusSelection: selection,
          model: activeAgent.modelId || undefined,
          providerId: activeProvider?.id,
          providerType: activeProvider?.type,
          baseUrl: activeProvider?.baseUrl,
          apiPath: activeProvider?.apiPath,
          requestTimeoutMs: activeProvider?.requestTimeoutMs,
          instructions: activeAgent.instructions,
          temperature: activeAgent.temperature,
        })) {
          setSnapshot((state) => applyMessageEvent(state, event, eventContext));
          if (event.type === "message.started") setSelectedNodeId(event.message.id);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "本地 ModelGateway 无法生成追问回复";
        const failedId = makeId("inquiry");
        setSnapshot((state) => ({
          ...state,
          nodes: [
            ...state.nodes,
            buildFailedReplyNode({
              id: failedId,
              timelineId,
              parentNodeId: userId,
              detail,
              author: activeAgent.name,
              model: activeAgent.modelId || undefined,
              inquiryRootId,
              now: new Date().toISOString(),
            }),
          ],
        }));
        setSelectedNodeId(failedId);
      }
      return userId;
    },
    [activeAgent, activeProvider, conversationService, openInquiry, preferences.profileName],
  );

  const forkFromNode = useCallback(
    async (nodeId: string, name: string, contextMode: ContextMode) => {
      authorizeTimelineTool("创建时间线分支");
      if (workspaceMode === "remote") {
        const timeline = await remoteService.forkFromMessage(nodeId, name, contextMode);
        setSnapshot((current) => ({
          ...current,
          timelines: [...current.timelines, timeline],
          currentConversationId: timeline.conversationId,
          currentTimelineId: timeline.id,
        }));
        setSelectedNodeId(nodeId);
        setMapOpen(true);
        return timeline.id;
      }
      const timelineId = makeId("timeline");
      const now = new Date().toISOString();
      setSnapshot((current) => forkTimeline(current, { nodeId, name, contextMode, timelineId, now }));
      setSelectedNodeId(nodeId);
      setMapOpen(true);
      return timelineId;
    },
    [authorizeTimelineTool, remoteService],
  );

  const createThreat = useCallback(
    async (nodeId: string, title: string, detail: string, severity: Threat["severity"]) => {
      authorizeTimelineTool("创建风险标记");
      if (workspaceMode === "remote") {
        const threat = await remoteService.createThreat({
          conversationId: snapshotRef.current.currentConversationId,
          nodeId,
          title,
          detail,
          severity,
        });
        setSnapshot((current) => ({ ...current, threats: [...current.threats, threat] }));
        setSelectedNodeId(nodeId);
        return;
      }
      const threat: Threat = {
        id: makeId("threat"),
        conversationId: snapshotRef.current.currentConversationId,
        nodeId,
        title,
        detail,
        severity,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      setSnapshot((current) => appendThreat(current, threat));
      setSelectedNodeId(nodeId);
    },
    [authorizeTimelineTool, remoteService],
  );

  const resolveThreat = useCallback(
    async (threatId: string) => {
      if (workspaceMode === "remote") {
        const currentThreat = snapshotRef.current.threats.find((threat) => threat.id === threatId);
        if (!currentThreat) return;
        const threat = await remoteService.resolveThreat(threatId, "已在当前工作区确认处理方案", currentThreat.version);
        setSnapshot((current) => ({
          ...current,
          threats: current.threats.map((item) => (item.id === threat.id ? threat : item)),
        }));
        return;
      }
      setSnapshot((current) =>
        resolveThreatById(current, threatId, "已在原型中确认处理方案", new Date().toISOString()),
      );
    },
    [remoteService],
  );

  const createReference = useCallback(
    async (sourceNodeId: string) => {
      authorizeTimelineTool("创建跨线引用");
      if (workspaceMode === "remote") {
        const result = await remoteService.createReference({
          sourceNodeId,
          targetTimelineId: snapshotRef.current.currentTimelineId,
          label: "手动引用",
        });
        setSnapshot((current) => ({
          ...current,
          nodes: [...current.nodes, result.node],
          references: [...current.references, result.link],
        }));
        return;
      }
      const now = new Date().toISOString();
      setSnapshot((current) =>
        appendManualReference(current, {
          sourceNodeId,
          nodeId: makeId("node"),
          referenceId: makeId("ref"),
          now,
        }),
      );
    },
    [authorizeTimelineTool, remoteService],
  );

  const createMergeSummary = useCallback(async () => {
    if (compareIds.length !== 2) return;
    if (workspaceMode === "remote") {
      const node = await remoteService.mergeSummary(compareIds, snapshotRef.current.currentTimelineId);
      setSnapshot((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedNodeId(node.id);
      return;
    }
    setSnapshot((current) => appendMergeSummary(current, compareIds, makeId("node"), new Date().toISOString()));
  }, [compareIds, remoteService]);

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      if (workspaceMode === "remote") {
        const conversation = await remoteService.renameConversation(conversationId, clean);
        setSnapshot((current) => ({
          ...current,
          conversations: current.conversations.map((item) => (item.id === conversation.id ? conversation : item)),
        }));
        return;
      }
      setSnapshot((current) => renameConversationById(current, conversationId, clean, new Date().toISOString()));
    },
    [remoteService],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (snapshotRef.current.conversations.length <= 1) return;
      if (workspaceMode === "remote") await remoteService.deleteConversation(conversationId);

      setSnapshot((current) => removeConversationCascade(current, conversationId));
      setSelectedNodeId(undefined);
      setFocusedInquiryId(undefined);
      setFocusedInquiryIds([]);
      setCompareIds([]);
    },
    [remoteService],
  );

  const updateMessage = useCallback(
    async (messageId: string, content: string) => {
      const clean = content.trim();
      if (!clean) return;
      const node = snapshotRef.current.nodes.find((item) => item.id === messageId);
      if (!node) return;
      if (node.kind !== "user" && node.kind !== "assistant") return;
      const updated =
        workspaceMode === "remote"
          ? await remoteService.updateMessage(messageId, clean)
          : await conversationService.updateMessage(messageId, clean);
      setSnapshot((current) => ({
        ...current,
        nodes: current.nodes.map((item) => (item.id === messageId ? { ...item, ...updated } : item)),
      }));
    },
    [conversationService, remoteService],
  );

  const editAndResendMessage = useCallback(
    async (messageId: string, content: string) => {
      const source = snapshotRef.current.nodes.find((item) => item.id === messageId);
      if (!source || source.kind !== "user") throw new Error("只有用户消息可以编辑并重新发送");
      const clean = content.trim();
      if (!clean) throw new Error("消息内容不能为空");
      const updated = workspaceMode === "remote"
        ? await remoteService.updateMessage(source.id, clean)
        : await conversationService.updateMessage(source.id, clean);
      const current = snapshotRef.current;
      const updatedSnapshot = {
        ...current,
        nodes: current.nodes.map((item) => (item.id === source.id ? { ...item, ...updated } : item)),
      };
      snapshotRef.current = updatedSnapshot;
      setSnapshot(updatedSnapshot);
      const storedAttachments = attachmentPayloadsRef.current.get(source.id) ?? source.metadata.attachments;
      await sendMessageOnTimeline(clean, {
        attachments: storedAttachments?.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          ...(attachment.textContent !== undefined ? { textContent: attachment.textContent } : {}),
          ...(attachment.dataUrl ? { dataUrl: attachment.dataUrl } : {}),
        })),
      }, {
        timelineId: current.currentTimelineId,
        parentNodeId: source.id,
        reuseUserNodeId: source.id,
      });
    },
    [conversationService, remoteService, sendMessageOnTimeline],
  );

  const retryMessage = useCallback(
    async (messageId: string) => {
      const failed = snapshotRef.current.nodes.find((item) => item.id === messageId);
      if (!failed || failed.kind !== "assistant") throw new Error("只能重试助手回复");
      const parent = snapshotRef.current.nodes.find((item) => item.id === failed.parentNodeId && item.kind === "user");
      if (!parent) throw new Error("找不到原始问题，无法重试");
      await editAndResendMessage(parent.id, parent.content);
    },
    [editAndResendMessage],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const root = snapshotRef.current.nodes.find((item) => item.id === messageId);
      if (!root) return;
      if (workspaceMode === "remote") await remoteService.deleteMessage(messageId);
      else await conversationService.deleteMessage(messageId);

      setSnapshot((current) => removeMessageCascade(current, messageId));
      setSelectedNodeId(undefined);
      setFocusedInquiryIds([]);
      setFocusedInquiryId(undefined);
    },
    [conversationService, remoteService],
  );

  const createConversation = useCallback(
    async (title: string) => {
      const clean = title.trim();
      if (!clean) return;
      if (workspaceMode === "remote") {
        const conversation = await remoteService.createConversation(clean);
        const graph = await remoteService.getGraph(conversation.id);
        setSnapshot((current) => ({
          ...current,
          conversations: [...current.conversations, graph.conversation],
          timelines: [...current.timelines, ...graph.timelines],
          nodes: [...current.nodes, ...graph.nodes],
          threats: [...current.threats, ...graph.threats],
          references: [...current.references, ...graph.references],
          currentConversationId: graph.conversation.id,
          currentTimelineId:
            graph.timelines.find((timeline) => timeline.status === "active")?.id ?? graph.timelines[0].id,
        }));
        setSelectedNodeId(undefined);
        setFocusedInquiryId(undefined);
        setFocusedInquiryIds([]);
        return;
      }
      const conversationId = makeId("conversation");
      const timelineId = makeId("timeline");
      const now = new Date().toISOString();
      setSnapshot((current) => appendConversation(current, { conversationId, timelineId, title: clean, now }));
      setSelectedNodeId(undefined);
      setFocusedInquiryId(undefined);
      setFocusedInquiryIds([]);
    },
    [remoteService],
  );

  const resetWorkspace = useCallback(async () => {
    if (workspaceMode === "remote") {
      const next = await remoteService.hydrate();
      setSnapshot(next);
      setSelectedNodeId(undefined);
      setFocusedInquiryId(undefined);
      setFocusedInquiryIds([]);
      setCompareIds([]);
      setSaveStatus("saved");
      return;
    }
    const next = await localRepository.reset();
    setSnapshot(next);
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
    setCompareIds([]);
  }, [localRepository, remoteService]);

  const exportWorkspace = useCallback(() => {
    const blob = new Blob([JSON.stringify(snapshotRef.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `5dmind-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const value: WorkspaceContextValue = {
    snapshot,
    hydrated,
    saveStatus,
    selectedNodeId,
    focusedInquiryId,
    focusedInquiryIds,
    mapOpen,
    mapPinned,
    compareIds,
    switchConversation,
    switchTimeline,
    selectNode,
    focusInquiry,
    openInquiry,
    closeInquiry,
    setMapOpen,
    setMapPinned,
    toggleCompare,
    sendMessage,
    generateAgentOpinions,
    createFocusedInquiry,
    forkFromNode,
    createThreat,
    resolveThreat,
    createReference,
    createMergeSummary,
    createConversation,
    renameConversation,
    deleteConversation,
    updateMessage,
    editAndResendMessage,
    retryMessage,
    deleteMessage,
    resetWorkspace,
    exportWorkspace,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
