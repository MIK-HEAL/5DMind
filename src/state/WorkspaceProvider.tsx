import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ContextMode,
  ConversationNode,
  FocusSelection,
  Threat,
  Timeline,
  WorkspaceSnapshot,
} from "../domain/types";
import type { ConversationService } from "../domain/services";
import type { ReasoningEffort } from "../domain/settings";
import { getInquiryTree, getLastNode, getNode, getOwnNodes, getTimelineNodes } from "../domain/selectors";
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
  sendMessage: (content: string, options?: { reasoningEffort?: ReasoningEffort; webSearch?: boolean; instructions?: string }) => Promise<void>;
  createFocusedInquiry: (sourceNodeId: string, selection: FocusSelection, question: string, parentNodeId?: string, openWindow?: boolean) => Promise<string>;
  forkFromNode: (nodeId: string, name: string, contextMode: ContextMode) => Promise<string>;
  createThreat: (nodeId: string, title: string, detail: string, severity: Threat["severity"]) => Promise<void>;
  resolveThreat: (threatId: string) => Promise<void>;
  createReference: (sourceNodeId: string) => Promise<void>;
  createMergeSummary: () => Promise<void>;
  createConversation: (title: string) => Promise<void>;
  resetWorkspace: () => Promise<void>;
  exportWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
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
  const snapshotRef = useRef(snapshot);
  const remoteService = useMemo(() => new HttpWorkspaceService(), []);
  const localRepository = runtimeTarget === "desktop" ? tauriWorkspaceRepository : workspaceRepository;

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  const conversationService = useMemo<ConversationService>(
    () => workspaceMode === "remote"
      ? remoteService
      : runtimeTarget === "desktop"
        ? new TauriConversationService(() => snapshotRef.current)
        : new UnavailableConversationService(() => snapshotRef.current),
    [remoteService],
  );
  const activeProvider = preferences.providers.find((provider) => provider.id === activeAgent.providerId);

  useEffect(() => {
    let active = true;
    const hydrate = workspaceMode === "remote"
      ? remoteService.hydrate()
      : localRepository.load();
    hydrate.then((loaded) => {
      if (!active) return;
      setSnapshot(loaded);
      setHydrated(true);
      setSaveStatus("saved");
    }).catch(() => {
      if (!active) return;
      // Keep the UI usable when the configured API is unavailable. Local mode
      // remains the explicit fallback; remote writes still report their errors.
      setSnapshot(createEmptyWorkspace());
      setHydrated(true);
      setSaveStatus("error");
    });
    return () => { active = false; };
  }, [localRepository, remoteService]);

  useEffect(() => {
    if (!hydrated || workspaceMode === "remote") return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      localRepository.save(snapshot)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [localRepository, snapshot, hydrated]);

  const switchConversation = useCallback((conversationId: string) => {
    setSnapshot((current) => {
      const timeline = current.timelines.find(
        (item) => item.conversationId === conversationId && item.status === "active",
      );
      if (!timeline) return current;
      return { ...current, currentConversationId: conversationId, currentTimelineId: timeline.id };
    });
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
    setCompareIds([]);
  }, []);

  const switchTimeline = useCallback((timelineId: string) => {
    setSnapshot((current) => {
      const timeline = current.timelines.find((item) => item.id === timelineId);
      if (!timeline) return current;
      return {
        ...current,
        currentConversationId: timeline.conversationId,
        currentTimelineId: timeline.id,
      };
    });
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
  }, []);

  const selectNode = useCallback((nodeId?: string) => {
    if (!nodeId) { setSelectedNodeId(undefined); return; }
    setSnapshot((current) => {
      const node = getNode(current, nodeId);
      if (!node) return current;
      const visibleOnCurrent = getTimelineNodes(current, current.currentTimelineId)
        .some((item) => item.id === nodeId);
      if (visibleOnCurrent) return current;
      const timeline = current.timelines.find((item) => item.id === node.timelineId);
      if (!timeline) return current;
      return {
        ...current,
        currentConversationId: timeline.conversationId,
        currentTimelineId: timeline.id,
      };
    });
    setSelectedNodeId(nodeId);
  }, []);

  const focusInquiry = useCallback((nodeId?: string) => {
    setFocusedInquiryId(nodeId);
    if (nodeId) setMapOpen(true);
  }, []);

  const openInquiry = useCallback((nodeId: string) => {
    setFocusedInquiryIds((current) => current.includes(nodeId) ? current : [...current, nodeId]);
    setFocusedInquiryId(nodeId);
    setMapOpen(true);
  }, []);

  const closeInquiry = useCallback((nodeId: string) => {
    const activeNodeId = focusedInquiryId;
    const activeBelongsToWindow = Boolean(activeNodeId && getInquiryTree(snapshotRef.current, nodeId).some((node) => node.id === activeNodeId));
    setFocusedInquiryIds((current) => {
      const next = current.filter((id) => id !== nodeId);
      if (activeBelongsToWindow) setFocusedInquiryId(next.at(-1));
      return next;
    });
  }, [focusedInquiryId]);

  const setMapPinned = useCallback((pinned: boolean) => {
    setMapPinnedState(pinned);
    if (pinned) setMapOpen(true);
  }, []);

  const toggleCompare = useCallback((timelineId: string) => {
    setCompareIds((current) => {
      if (current.includes(timelineId)) return current.filter((id) => id !== timelineId);
      return [...current.slice(-1), timelineId];
    });
  }, []);

  const sendMessage = useCallback(async (content: string, options?: { reasoningEffort?: ReasoningEffort; webSearch?: boolean; instructions?: string }) => {
    const clean = content.trim();
    if (!clean) return;
    const timelineId = snapshotRef.current.currentTimelineId;
    const now = new Date().toISOString();
    const userId = makeId("node");
    const parentNodeId = getLastNode(snapshotRef.current, timelineId)?.id;
    const userNode: ConversationNode = {
      id: userId, timelineId, parentNodeId,
      kind: "user", content: clean, summary: clean.slice(0, 44), status: "complete",
      createdAt: now, metadata: { author: preferences.profileName.trim() || "你" },
    };
    setSnapshot((current) => ({ ...current, nodes: [...current.nodes, userNode] }));
    setSelectedNodeId(userId);

    try {
      for await (const event of conversationService.sendMessage({
        timelineId,
        content: clean,
        clientMessageId: userId,
        parentNodeId,
        model: activeAgent.modelId || undefined,
        providerId: activeProvider?.id,
        providerType: activeProvider?.type,
        baseUrl: activeProvider?.baseUrl,
        apiPath: activeProvider?.apiPath,
        requestTimeoutMs: activeProvider?.requestTimeoutMs,
        instructions: options?.instructions?.trim() || activeAgent.instructions,
        temperature: activeAgent.temperature,
        reasoningEffort: options?.reasoningEffort ?? activeAgent.reasoningEffort ?? "default",
        webSearch: options?.webSearch ?? activeAgent.tools.webSearch,
      })) {
        if (event.type === "message.started") {
          setSnapshot((current) => ({
            ...current,
            nodes: [...current.nodes, {
              ...event.message,
              parentNodeId: userId,
              metadata: {
                ...event.message.metadata,
                author: activeAgent.name,
                model: event.message.metadata.model ?? activeAgent.modelId,
              },
            }],
          }));
          setSelectedNodeId(event.message.id);
        } else if (event.type === "message.delta") {
          setSnapshot((current) => ({
            ...current,
            nodes: current.nodes.map((node) => node.id === event.messageId
              ? { ...node, content: node.content + event.delta }
              : node),
          }));
        } else if (event.type === "message.reasoning_delta") {
          setSnapshot((current) => ({
            ...current,
            nodes: current.nodes.map((node) => node.id === event.messageId
              ? { ...node, metadata: { ...node.metadata, reasoning: `${node.metadata.reasoning ?? ""}${event.delta}` } }
              : node),
          }));
        } else if (event.type === "message.completed") {
          setSnapshot((current) => ({
            ...current,
            nodes: current.nodes.map((node) => node.id === event.messageId
              ? { ...node, status: "complete", summary: workspaceMode === "remote" ? "云端回复" : "本地回复" }
              : node),
          }));
        } else if (event.type === "message.failed") {
          setSnapshot((current) => ({
            ...current,
            nodes: current.nodes.map((node) => node.id === event.messageId
              ? { ...node, status: "failed", summary: event.error }
              : node),
          }));
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "本地 ModelGateway 无法生成回复";
      const failedId = makeId("node");
      setSnapshot((current) => ({
        ...current,
        nodes: [...current.nodes, {
          id: failedId,
          timelineId,
          parentNodeId: userId,
          kind: "assistant",
          content: `无法生成回复\n\n${detail}`,
          summary: "回复失败",
          status: "failed",
          createdAt: new Date().toISOString(),
          metadata: { author: activeAgent.name, model: activeAgent.modelId || "未配置模型" },
        }],
      }));
      setSelectedNodeId(failedId);
    }
  }, [activeAgent, activeProvider, conversationService, preferences.profileName]);

  const createFocusedInquiry = useCallback(async (
    sourceNodeId: string, selection: FocusSelection, question: string,
    parentNodeId = sourceNodeId, openWindow = true,
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
        if (event.type === "message.started") {
          setSnapshot((state) => ({
            ...state,
            nodes: [...state.nodes, {
              ...event.message,
              relation: "focused-inquiry",
              inquiryRootId,
              parentNodeId: userId,
              metadata: {
                ...event.message.metadata,
                author: activeAgent.name,
                model: event.message.metadata.model ?? activeAgent.modelId,
                tags: [...(event.message.metadata.tags ?? []), "选区追问"],
              },
            }],
          }));
          setSelectedNodeId(event.message.id);
        } else if (event.type === "message.delta") {
          setSnapshot((state) => ({
            ...state,
            nodes: state.nodes.map((node) => node.id === event.messageId
              ? { ...node, content: node.content + event.delta }
              : node),
          }));
        } else if (event.type === "message.reasoning_delta") {
          setSnapshot((state) => ({
            ...state,
            nodes: state.nodes.map((node) => node.id === event.messageId
              ? { ...node, metadata: { ...node.metadata, reasoning: `${node.metadata.reasoning ?? ""}${event.delta}` } }
              : node),
          }));
        } else if (event.type === "message.completed") {
          setSnapshot((state) => ({
            ...state,
            nodes: state.nodes.map((node) => node.id === event.messageId
              ? { ...node, status: "complete", summary: workspaceMode === "remote" ? "云端追问回复" : "追问回复" }
              : node),
          }));
        } else if (event.type === "message.failed") {
          setSnapshot((state) => ({
            ...state,
            nodes: state.nodes.map((node) => node.id === event.messageId
              ? { ...node, status: "failed", summary: event.error }
              : node),
          }));
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "本地 ModelGateway 无法生成追问回复";
      const failedId = makeId("inquiry");
      setSnapshot((state) => ({
        ...state,
        nodes: [...state.nodes, {
          id: failedId,
          timelineId,
          parentNodeId: userId,
          relation: "focused-inquiry",
          inquiryRootId,
          kind: "assistant",
          content: `无法生成追问回复\n\n${detail}`,
          summary: "追问回复失败",
          status: "failed",
          createdAt: new Date().toISOString(),
          metadata: { author: activeAgent.name, model: activeAgent.modelId || "未配置模型", tags: ["选区追问"] },
        }],
      }));
      setSelectedNodeId(failedId);
    }
    return userId;
  }, [activeAgent, activeProvider, conversationService, openInquiry, preferences.profileName]);

  const forkFromNode = useCallback(async (nodeId: string, name: string, contextMode: ContextMode) => {
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
    setSnapshot((current) => {
      const source = getNode(current, nodeId);
      if (!source) return current;
      const now = new Date().toISOString();
      const timeline: Timeline = {
        id: timelineId, conversationId: current.currentConversationId,
        name: name.trim() || `分支 · ${source.summary}`,
        parentTimelineId: current.currentTimelineId, forkedFromNodeId: nodeId, contextMode,
        status: "active", color: ["#a84d35", "#4b67b0", "#7a5ba6", "#ce6d39"][current.timelines.length % 4],
        createdAt: now, updatedAt: now,
      };
      return { ...current, timelines: [...current.timelines, timeline], currentTimelineId: timelineId };
    });
    setSelectedNodeId(nodeId);
    setMapOpen(true);
    return timelineId;
  }, [remoteService]);

  const createThreat = useCallback(async (
    nodeId: string, title: string, detail: string, severity: Threat["severity"],
  ) => {
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
      id: makeId("threat"), conversationId: snapshotRef.current.currentConversationId,
      nodeId, title, detail, severity, status: "open", createdAt: new Date().toISOString(),
    };
    setSnapshot((current) => ({ ...current, threats: [...current.threats, threat] }));
    setSelectedNodeId(nodeId);
  }, [remoteService]);

  const resolveThreat = useCallback(async (threatId: string) => {
    if (workspaceMode === "remote") {
      const currentThreat = snapshotRef.current.threats.find((threat) => threat.id === threatId);
      if (!currentThreat) return;
      const threat = await remoteService.resolveThreat(
        threatId,
        "已在当前工作区确认处理方案",
        currentThreat.version,
      );
      setSnapshot((current) => ({
        ...current,
        threats: current.threats.map((item) => item.id === threat.id ? threat : item),
      }));
      return;
    }
    setSnapshot((current) => ({
      ...current,
      threats: current.threats.map((threat) => threat.id === threatId ? {
        ...threat, status: "resolved", resolution: "已在原型中确认处理方案",
        resolvedAt: new Date().toISOString(),
      } : threat),
    }));
  }, [remoteService]);

  const createReference = useCallback(async (sourceNodeId: string) => {
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
    setSnapshot((current) => {
      const source = getNode(current, sourceNodeId);
      if (!source) return current;
      const timelineId = current.currentTimelineId;
      const id = makeId("node");
      const sourceTimeline = current.timelines.find((item) => item.id === source.timelineId);
      const sourceConversation = current.conversations.find((item) => item.id === sourceTimeline?.conversationId);
      const target: ConversationNode = {
        id, timelineId, parentNodeId: getLastNode(current, timelineId)?.id, kind: "reference",
        content: source.content, summary: `引用：${source.summary}`, sourceNodeIds: [source.id],
        status: "complete", createdAt: new Date().toISOString(),
        metadata: { boardName: sourceConversation?.title ?? "当前工作区", tags: ["显式引用"] },
      };
      return {
        ...current,
        nodes: [...current.nodes, target],
        references: [...current.references, {
          id: makeId("ref"), sourceNodeId, targetNodeId: id, label: "手动引用",
          createdAt: new Date().toISOString(),
        }],
      };
    });
  }, [remoteService]);

  const createMergeSummary = useCallback(async () => {
    if (compareIds.length !== 2) return;
    if (workspaceMode === "remote") {
      const node = await remoteService.mergeSummary(compareIds, snapshotRef.current.currentTimelineId);
      setSnapshot((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedNodeId(node.id);
      return;
    }
    setSnapshot((current) => {
      const summaries = compareIds.map((id) => {
        const timeline = current.timelines.find((item) => item.id === id);
        const conclusion = getOwnNodes(current, id).at(-1);
        return `${timeline?.name ?? id}：${conclusion?.summary ?? "尚无独立结论"}`;
      });
      const node: ConversationNode = {
        id: makeId("node"), timelineId: current.currentTimelineId,
        parentNodeId: getLastNode(current, current.currentTimelineId)?.id, kind: "merge",
        content: `分支比较摘要\n\n${summaries.join("\n")}\n\n共同建议：保留可读的聊天主界面，用地图表达结构和风险，并继续用真实任务验证。`,
        summary: "合并两条分支的比较结论", sourceNodeIds: compareIds.flatMap((id) => getOwnNodes(current, id).map((node) => node.id)),
        status: "complete", createdAt: new Date().toISOString(), metadata: { tags: ["合并摘要"] },
      };
      return { ...current, nodes: [...current.nodes, node] };
    });
  }, [compareIds, remoteService]);

  const createConversation = useCallback(async (title: string) => {
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
        currentTimelineId: graph.timelines.find((timeline) => timeline.status === "active")?.id ?? graph.timelines[0].id,
      }));
      setSelectedNodeId(undefined);
      setFocusedInquiryId(undefined);
      setFocusedInquiryIds([]);
      return;
    }
    const conversationId = makeId("conversation");
    const timelineId = makeId("timeline");
    const now = new Date().toISOString();
    setSnapshot((current) => ({
      ...current,
      conversations: [...current.conversations, {
        id: conversationId, title: clean, summary: "新的本地工作区", color: "#7a5ba6",
        createdAt: now, updatedAt: now,
      }],
      timelines: [...current.timelines, {
        id: timelineId, conversationId, name: "主线", contextMode: "until-node",
        status: "active", color: "#7a5ba6", createdAt: now, updatedAt: now,
      }],
      currentConversationId: conversationId, currentTimelineId: timelineId,
    }));
    setSelectedNodeId(undefined);
    setFocusedInquiryId(undefined);
    setFocusedInquiryIds([]);
  }, [remoteService]);

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
  }, [remoteService]);

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
    snapshot, hydrated, saveStatus, selectedNodeId, focusedInquiryId, focusedInquiryIds, mapOpen, mapPinned, compareIds,
    switchConversation, switchTimeline, selectNode, focusInquiry, openInquiry, closeInquiry, setMapOpen, setMapPinned, toggleCompare,
    sendMessage, createFocusedInquiry, forkFromNode, createThreat, resolveThreat, createReference, createMergeSummary,
    createConversation, resetWorkspace, exportWorkspace,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
