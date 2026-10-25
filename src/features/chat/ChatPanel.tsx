import {
  ArrowUp,
  Bot,
  Brain,
  ChevronRight,
  Columns2,
  GitBranch,
  Globe2,
  Layers2,
  Paperclip,
  Quote,
  Settings2,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import { Select } from "../../components/ui/Select";
import { invoke } from "@tauri-apps/api/core";
import { open as openNativeFileDialog } from "@tauri-apps/plugin-dialog";
import type { ContextMode, ConversationNode, FocusSelection, Threat } from "../../domain/types";
import { buildContextPreview } from "../../domain/context";
import {
  formatAttachmentSize,
  isTextAttachment,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENT_TEXT,
  MAX_ATTACHMENT_TOTAL_SIZE,
  type MessageAttachment,
} from "../../domain/attachments";
import type { ReasoningEffort } from "../../domain/settings";
import {
  getFocusedInquiryRoots,
  getInquiryTree,
  getTimeline,
  getTimelineNodes,
  isFocusedInquiry,
} from "../../domain/selectors";
import { useSettings } from "../../state/SettingsProvider";
import { useWorkspace } from "../../state/WorkspaceProvider";
import { runtimeTarget, workspaceMode } from "../../infrastructure/runtime";
import { MessageMarkdown, ReasoningBlock, splitNodeContent } from "./MessageMarkdown";
import { MessageCard } from "./MessageCard";

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}

interface SelectionState extends FocusSelection {
  left: number;
  top: number;
}

interface InquiryDragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

function contentHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

const blockedAttachmentExtensions = /\.(exe|dll|dmg|app|sh|bat|cmd|ps1|com)$/i;

interface NativeAttachment {
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
  dataUrl?: string;
}

async function readNativeAttachment(path: string): Promise<MessageAttachment> {
  const native = await invoke<NativeAttachment>("read_local_attachment", { path });
  return {
    id: `${path}-${native.size}-${native.name}`,
    name: native.name,
    mimeType: native.mimeType,
    size: native.size,
    ...(native.textContent !== undefined ? { textContent: native.textContent } : {}),
    ...(native.dataUrl ? { dataUrl: native.dataUrl } : {}),
  };
}

async function readAttachment(file: File): Promise<MessageAttachment> {
  const nativePath = (file as File & { path?: string }).path;
  if (runtimeTarget === "desktop" && nativePath) {
    return readNativeAttachment(nativePath);
  }
  const textContent = isTextAttachment(file) ? (await file.text()).slice(0, MAX_ATTACHMENT_TEXT) : undefined;
  const dataUrl = textContent === undefined ? await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsDataURL(file);
  }) : undefined;
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    ...(textContent !== undefined ? { textContent } : {}),
    ...(dataUrl ? { dataUrl } : {}),
  };
}

function Modal({ title, children, onClose, className }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{title}</strong>
          <button title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

const inquiryTimeFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

function InquiryMessageList({
  tree,
  rootId,
  activeNodeId,
  showTimestamps,
  onChooseNode,
}: {
  tree: ConversationNode[];
  rootId: string;
  activeNodeId?: string;
  showTimestamps: boolean;
  onChooseNode: (node: ConversationNode) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = tree.at(-1);
  const streaming = last?.status === "streaming" || last?.status === "pending";

  useEffect(() => {
    if (!streaming) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [streaming, last?.id, last?.content.length, last?.metadata.reasoning?.length]);

  return (
    <div className="inquiry-focus-tree" ref={scrollRef}>
      {tree.map((node) => {
        let depth = 0;
        let parent = node.parentNodeId;
        while (parent && parent !== rootId && depth < 4) {
          const parentNode = tree.find((item) => item.id === parent);
          if (!parentNode) break;
          depth += 1;
          parent = parentNode.parentNodeId;
        }
        const { reasoning, answer } = splitNodeContent(node);
        const active = activeNodeId === node.id;
        return (
          <div
            key={node.id}
            className={`inquiry-message ${node.kind} ${node.status} ${active ? "is-active" : ""}`}
            style={{ marginLeft: depth * 14 }}
            title="点击设为继续追问的起点"
            onClick={() => {
              if (window.getSelection()?.toString()) return;
              onChooseNode(node);
            }}
          >
            <header>
              <span className="inquiry-message-badge">{node.kind === "user" ? "你" : "5D"}</span>
              <strong>
                {node.kind === "user"
                  ? (node.metadata.author ?? "你")
                  : node.metadata.model || node.metadata.author || "5D 助手"}
              </strong>
              {showTimestamps && <time>{inquiryTimeFormat.format(new Date(node.createdAt))}</time>}
              <span className="inquiry-message-meta">
                {node.status === "streaming" && <em>生成中</em>}
                {node.status === "failed" && <em className="failed">请求失败</em>}
                {active && <em className="active">追问起点</em>}
              </span>
            </header>
            {reasoning && <ReasoningBlock content={reasoning} streaming={node.status === "streaming"} />}
            <div className="message-content inquiry-message-content">
              <MessageMarkdown>{answer}</MessageMarkdown>
              {node.status === "streaming" && <span className="typing-caret" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatPanel() {
  const {
    snapshot,
    selectedNodeId,
    selectNode,
    mapOpen,
    setMapOpen,
    sendMessage,
    generateAgentOpinions,
    forkFromNode,
    createThreat,
    createReference,
    createFocusedInquiry,
    focusedInquiryId,
    focusedInquiryIds,
    focusInquiry,
    openInquiry,
    closeInquiry,
    updateMessage,
    editAndResendMessage,
    retryMessage,
    deleteMessage,
  } = useWorkspace();
  const { activeAgent, preferences } = useSettings();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [forkNodeId, setForkNodeId] = useState<string>();
  const [threatNodeId, setThreatNodeId] = useState<string>();
  const [opinionNodeId, setOpinionNodeId] = useState<string>();
  const [opinionAgentIds, setOpinionAgentIds] = useState<string[]>([]);
  const [opinionLayout, setOpinionLayout] = useState<"stack" | "flat">("stack");
  const [opinionCursors, setOpinionCursors] = useState<Record<string, number>>({});
  const [opinionSending, setOpinionSending] = useState(false);
  const [deleteNodeId, setDeleteNodeId] = useState<string>();
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [messageActionError, setMessageActionError] = useState<string>();
  const [branchName, setBranchName] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>("until-node");
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [threatTitle, setThreatTitle] = useState("");
  const [threatDetail, setThreatDetail] = useState("");
  const [severity, setSeverity] = useState<Threat["severity"]>("medium");
  const [selection, setSelection] = useState<SelectionState>();
  const [inquiryDraft, setInquiryDraft] = useState("");
  const [inquiryComposerOpen, setInquiryComposerOpen] = useState(false);
  const [inquirySending, setInquirySending] = useState(false);
  const [inquiryReplyDrafts, setInquiryReplyDrafts] = useState<Record<string, string>>({});
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attachmentDragging, setAttachmentDragging] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(activeAgent.reasoningEffort ?? "default");
  const [webSearch, setWebSearch] = useState(activeAgent.tools.webSearch);
  const [instructionsOverride, setInstructionsOverride] = useState("");
  const [replySendingIds, setReplySendingIds] = useState<Record<string, boolean>>({});
  const [activeInquiryNodeIds, setActiveInquiryNodeIds] = useState<Record<string, string | undefined>>({});
  const [windowPositions, setWindowPositions] = useState<Record<string, { x: number; y: number }>>({});
  const inquiryDragRef = useRef<InquiryDragState | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const timeline = getTimeline(snapshot, snapshot.currentTimelineId);
  const nodes = useMemo(
    () => getTimelineNodes(snapshot, timeline.id).filter((node) => !isFocusedInquiry(node) && !(node.kind === "assistant" && node.metadata.opinionGroupId)),
    [snapshot, timeline.id],
  );
  const opinionGroups = useMemo(() => {
    const groups = new Map<string, ConversationNode[]>();
    for (const node of getTimelineNodes(snapshot, timeline.id)) {
      if (!node.metadata.opinionGroupId || node.kind !== "assistant") continue;
      const group = groups.get(node.metadata.opinionGroupId) ?? [];
      group.push(node);
      groups.set(node.metadata.opinionGroupId, group);
    }
    return [...groups.entries()];
  }, [snapshot, timeline.id]);
  const opinionSource = opinionNodeId ? snapshot.nodes.find((node) => node.id === opinionNodeId) : undefined;
  const contextPreview = useMemo(
    () => buildContextPreview(snapshot, {
      timelineId: timeline.id,
      content: draft,
      instructions: instructionsOverride.trim() || activeAgent.instructions,
      attachments: activeAgent.tools.files ? attachments : undefined,
      webSearch,
    }),
    [activeAgent.instructions, activeAgent.tools.files, attachments, draft, instructionsOverride, snapshot, timeline.id, webSearch],
  );

  const [prevAgentId, setPrevAgentId] = useState(activeAgent.id);
  if (prevAgentId !== activeAgent.id) {
    setPrevAgentId(activeAgent.id);
    setReasoningEffort(activeAgent.reasoningEffort ?? "default");
    setWebSearch(activeAgent.tools.webSearch);
    setInstructionsOverride("");
  }

  useEffect(() => {
    if (!selectedNodeId) return;
    const target = document.querySelector(`[data-message-id="${selectedNodeId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedNodeId, timeline.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    const content = draft;
    setDraft("");
    setSending(true);
    try {
      await sendMessage(content, {
        reasoningEffort,
        webSearch,
        instructions: instructionsOverride.trim() || undefined,
        attachments: activeAgent.tools.files ? attachments : undefined,
      });
      setAttachments([]);
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setSending(false);
    }
  };

  const addAttachments = async (files: FileList | File[]) => {
    if (!activeAgent.tools.files) {
      setAttachmentError("当前 Agent 未启用文件工具");
      return;
    }
    const incoming = Array.from(files);
    if (!incoming.length) return;
    const availableSlots = MAX_ATTACHMENT_COUNT - attachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(`最多同时附加 ${MAX_ATTACHMENT_COUNT} 个文件`);
      return;
    }
    const accepted: File[] = [];
    for (const file of incoming.slice(0, availableSlots)) {
      if (blockedAttachmentExtensions.test(file.name)) {
        setAttachmentError(`不支持上传可执行文件：${file.name}`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setAttachmentError(`${file.name} 超过单文件 ${formatAttachmentSize(MAX_ATTACHMENT_SIZE)} 限制`);
        continue;
      }
      accepted.push(file);
    }
    const nextTotal = attachments.reduce((sum, item) => sum + item.size, 0) + accepted.reduce((sum, file) => sum + file.size, 0);
    if (nextTotal > MAX_ATTACHMENT_TOTAL_SIZE) {
      setAttachmentError(`附件总大小不能超过 ${formatAttachmentSize(MAX_ATTACHMENT_TOTAL_SIZE)}`);
      return;
    }
    try {
      const loaded = await Promise.all(accepted.map(readAttachment));
      setAttachments((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...loaded.filter((item) => !seen.has(item.id))];
      });
      setAttachmentError(undefined);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "文件读取失败，请重试");
    }
  };

  const openAttachments = async () => {
    if (!activeAgent.tools.files) {
      setAttachmentError("当前 Agent 未启用文件工具");
      return;
    }
    if (runtimeTarget !== "desktop") {
      attachmentInputRef.current?.click();
      return;
    }
    try {
      const selected = await openNativeFileDialog({
        multiple: true,
        directory: false,
        filters: [{
          name: "支持的文件",
          extensions: [
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "md", "mdx", "txt", "csv",
            "json", "jsonl", "xml", "yaml", "yml", "log", "ts", "tsx", "js", "jsx", "css", "html",
            "sql", "png", "jpg", "jpeg", "gif", "webp", "svg", "mp3", "wav", "mp4", "webm",
          ],
        }],
      });
      if (!selected) return;
      const paths = (Array.isArray(selected) ? selected : [selected]).slice(0, MAX_ATTACHMENT_COUNT - attachments.length);
      if (!paths.length) {
        setAttachmentError(`最多同时附加 ${MAX_ATTACHMENT_COUNT} 个文件`);
        return;
      }
      const loaded = await Promise.allSettled(paths.map(readNativeAttachment));
      const successful = loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failed = loaded.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (successful.length) {
        const currentSize = attachments.reduce((sum, item) => sum + item.size, 0);
        const incomingSize = successful.reduce((sum, item) => sum + item.size, 0);
        if (currentSize + incomingSize > MAX_ATTACHMENT_TOTAL_SIZE) {
          setAttachmentError(`附件总大小不能超过 ${formatAttachmentSize(MAX_ATTACHMENT_TOTAL_SIZE)}`);
          return;
        }
        setAttachments((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...successful.filter((item) => !seen.has(item.id))];
        });
      }
      setAttachmentError(failed
        ? failed.reason instanceof Error ? failed.reason.message : "文件读取失败，请重试"
        : undefined);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "打开文件选择器失败，请重试");
    }
  };

  const selectMessageText = (
    nodeId: string,
    kind: string,
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => {
    if (kind !== "assistant") return;
    const browserSelection = window.getSelection();
    const text = browserSelection?.toString().trim();
    const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : undefined;
    if (!text || !range || !event.currentTarget.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    const sourceNode = snapshot.nodes.find((node) => node.id === nodeId);
    if (!sourceNode) return;
    setSelection({
      sourceNodeId: nodeId,
      text: text.slice(0, 1200),
      start: range.startOffset,
      end: range.endOffset,
      contentHash: contentHash(sourceNode.content),
      left: Math.min(Math.max(12, rect.left), window.innerWidth - 250),
      top: Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - 80),
    });
  };

  const openInquiryComposer = () => {
    setInquiryDraft("");
    setInquiryComposerOpen(true);
    setSelection((current) =>
      current ? { ...current, top: Math.min(current.top + 42, window.innerHeight - 280) } : current,
    );
  };

  const submitInquiry = async (event: FormEvent) => {
    event.preventDefault();
    if (!selection || !inquiryDraft.trim() || inquirySending) return;
    const currentSelection = selection;
    setInquirySending(true);
    try {
      await createFocusedInquiry(
        currentSelection.sourceNodeId,
        {
          sourceNodeId: currentSelection.sourceNodeId,
          text: currentSelection.text,
          start: currentSelection.start,
          end: currentSelection.end,
          contentHash: currentSelection.contentHash,
        },
        inquiryDraft,
      );
      setSelection(undefined);
      setInquiryDraft("");
      setInquiryComposerOpen(false);
    } finally {
      setInquirySending(false);
    }
  };

  const inquiryWindows = focusedInquiryIds.flatMap((rootId) => {
    const root = snapshot.nodes.find((node) => node.id === rootId && isFocusedInquiry(node));
    if (!root) return [];
    const tree = getInquiryTree(snapshot, root.id);
    const source = root.focusSelection?.sourceNodeId
      ? snapshot.nodes.find((node) => node.id === root.focusSelection?.sourceNodeId)
      : undefined;
    return [{ root, tree, source }];
  });

  const handleInquiryPointerDown = (id: string, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const origin = windowPositions[id] ?? { x: 0, y: 0 };
    inquiryDragRef.current = { id, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleInquiryPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = inquiryDragRef.current;
    if (!drag) return;
    const x = Math.max(-window.innerWidth * 0.78, Math.min(80, drag.originX + event.clientX - drag.startX));
    const y = Math.max(-window.innerHeight * 0.64, Math.min(100, drag.originY + event.clientY - drag.startY));
    setWindowPositions((current) => ({ ...current, [drag.id]: { x, y } }));
  };

  const handleInquiryPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    inquiryDragRef.current = undefined;
  };

  const submitInquiryReply = async (rootId: string, tree: ConversationNode[]) => {
    const root = snapshot.nodes.find((node) => node.id === rootId && isFocusedInquiry(node));
    const draft = inquiryReplyDrafts[rootId] ?? "";
    if (!root?.focusSelection || !draft.trim() || replySendingIds[rootId]) return;
    const lastAssistant = [...tree].reverse().find((node) => node.kind === "assistant");
    const parentNodeId = activeInquiryNodeIds[rootId] ?? lastAssistant?.id ?? root.id;
    setReplySendingIds((current) => ({ ...current, [rootId]: true }));
    try {
      const createdId = await createFocusedInquiry(
        root.focusSelection.sourceNodeId,
        root.focusSelection,
        draft,
        parentNodeId,
        false,
      );
      setActiveInquiryNodeIds((current) => ({ ...current, [rootId]: createdId }));
      focusInquiry(createdId);
      setInquiryReplyDrafts((current) => ({ ...current, [rootId]: "" }));
    } finally {
      setReplySendingIds((current) => ({ ...current, [rootId]: false }));
    }
  };

  return (
    <section className="chat-panel">
      <div className="messages-scroll">
        {nodes.length ? (
          nodes.map((node) => (
            <MessageCard
              key={`${timeline.id}-${node.id}`}
              node={node}
              nodeTimeline={snapshot.timelines.find((item) => item.id === node.timelineId)}
              currentTimelineId={timeline.id}
              selected={selectedNodeId === node.id}
              threats={snapshot.threats.filter((threat) => threat.nodeId === node.id)}
              inquiries={getFocusedInquiryRoots(snapshot, node.id, timeline.id)}
              onSelect={() => selectNode(node.id)}
              onFork={() => {
                setForkNodeId(node.id);
                setBranchName(`分支 · ${node.summary}`);
              }}
              onThreat={() => {
                setThreatNodeId(node.id);
                setThreatTitle(`风险 · ${node.summary}`);
              }}
              onReference={() => createReference(node.id)}
              onCompare={() => {
                setOpinionNodeId(node.id);
                setOpinionAgentIds(preferences.agents.filter((agent) => agent.id !== activeAgent.id).slice(0, 2).map((agent) => agent.id));
              }}
              timelineToolsEnabled={activeAgent.tools.timeline && activeAgent.permissionMode !== "read-only"}
              onEdit={updateMessage}
              onEditAndResend={editAndResendMessage}
              onRetry={retryMessage}
              onDelete={() => setDeleteNodeId(node.id)}
              onSelectText={(event) => selectMessageText(node.id, node.kind, event)}
              onOpenInquiry={(nodeId) => {
                openInquiry(nodeId);
                selectNode(nodeId);
              }}
            />
          ))
        ) : (
          <div className="empty-chat">
            <span className="empty-agent" style={{ backgroundColor: activeAgent.color }}>
              <Bot size={22} />
            </span>
            <strong>{activeAgent.name}</strong>
            <span>{activeAgent.description || "今天想一起处理什么？"}</span>
          </div>
        )}
        {opinionGroups.map(([groupId, allOpinions]) => {
          const opinions = allOpinions.slice(-2);
          const cursor = Math.min(opinionCursors[groupId] ?? 0, Math.max(0, opinions.length - 1));
          const displayOpinions = opinionLayout === "flat"
            ? opinions
            : opinions.length === 2
              ? [opinions[cursor], opinions[cursor === 0 ? 1 : 0]]
              : opinions;
          return (
          <section className={`agent-opinion-panel ${opinionLayout}`} key={groupId}>
            <div className="agent-opinion-toolbar">
              <button
                type="button"
                className="agent-opinion-layout-toggle"
                title={opinionLayout === "stack" ? "切换为平铺" : "切换为堆叠"}
                aria-label={opinionLayout === "stack" ? "切换为平铺" : "切换为堆叠"}
                aria-pressed={opinionLayout === "flat"}
                onClick={() => setOpinionLayout((layout) => layout === "stack" ? "flat" : "stack")}
              >
                {opinionLayout === "stack" ? <Columns2 size={15} /> : <Layers2 size={15} />}
              </button>
            </div>
            <div className="agent-opinion-grid">
              {displayOpinions.map((opinion, opinionIndex) => (
                <div className={`agent-opinion-card ${opinionIndex === 0 ? "active" : "underlay"}`} key={opinion.id}>
                <MessageCard
                  node={opinion}
                  nodeTimeline={timeline}
                  currentTimelineId={timeline.id}
                  selected={selectedNodeId === opinion.id}
                  threats={snapshot.threats.filter((threat) => threat.nodeId === opinion.id)}
                  inquiries={getFocusedInquiryRoots(snapshot, opinion.id, timeline.id)}
                  onSelect={() => selectNode(opinion.id)}
                  onFork={() => {
                    setForkNodeId(opinion.id);
                    setBranchName(`分支 · ${opinion.summary}`);
                  }}
                  onThreat={() => {
                    setThreatNodeId(opinion.id);
                    setThreatTitle(`风险 · ${opinion.summary}`);
                  }}
                  onReference={() => createReference(opinion.id)}
                  onCompare={() => {
                    setOpinionNodeId(opinion.id);
                    setOpinionAgentIds(preferences.agents.filter((agent) => agent.id !== activeAgent.id).slice(0, 2).map((agent) => agent.id));
                  }}
                  timelineToolsEnabled={activeAgent.tools.timeline && activeAgent.permissionMode !== "read-only"}
                  onEdit={updateMessage}
                  onEditAndResend={editAndResendMessage}
                  onRetry={retryMessage}
                  onDelete={() => setDeleteNodeId(opinion.id)}
                  onSelectText={(event) => selectMessageText(opinion.id, opinion.kind, event)}
                  onOpenInquiry={(nodeId) => {
                    openInquiry(nodeId);
                    selectNode(nodeId);
                  }}
                  onDoubleClick={opinionLayout === "stack" && opinions.length === 2 && opinionIndex === 0
                    ? () => setOpinionCursors((current) => ({ ...current, [groupId]: cursor === 0 ? 1 : 0 }))
                    : undefined}
                />
                </div>
              ))}
            </div>
          </section>
          );
        })}
        <div ref={endRef} />
      </div>

      {opinionNodeId && (
        <Modal className="opinion-modal" title="选择意见来源" onClose={() => setOpinionNodeId(undefined)}>
          <div className="opinion-picker">
            {opinionSource && (
              <div className="opinion-source-preview">
                <span>正在重审</span>
                <strong>{opinionSource.summary}</strong>
                <p>{opinionSource.content.slice(0, 180)}{opinionSource.content.length > 180 ? "…" : ""}</p>
              </div>
            )}
            <div className="opinion-picker-heading">
              <div><strong>选择视角</strong></div>
              <span>{opinionAgentIds.length} / 2</span>
            </div>
            <div className="opinion-agent-list">
              {preferences.agents.map((agent) => (
                <label key={agent.id} className={`opinion-agent-option ${opinionAgentIds.includes(agent.id) ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={opinionAgentIds.includes(agent.id)}
                    onChange={() => setOpinionAgentIds((current) => current.includes(agent.id)
                      ? current.filter((id) => id !== agent.id)
                      : current.length >= 2 ? current : [...current, agent.id])}
                  />
                  <span className="opinion-agent-mark" style={{ "--agent-color": agent.color } as React.CSSProperties}><Bot size={15} /></span>
                  <span className="opinion-agent-copy"><strong>{agent.name}</strong><small>{agent.description}</small></span>
                  <span className="opinion-agent-check"><span /></span>
                </label>
              ))}
            </div>
            <footer className="modal-actions">
              <button type="button" className="secondary" onClick={() => setOpinionNodeId(undefined)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={opinionSending || opinionAgentIds.length === 0}
                onClick={async () => {
                  if (!opinionNodeId) return;
                  setOpinionSending(true);
                  try {
                    await generateAgentOpinions(opinionNodeId, opinionAgentIds);
                    setOpinionNodeId(undefined);
                  } finally {
                    setOpinionSending(false);
                  }
                }}
              >{opinionSending ? "生成中…" : "生成意见"}</button>
            </footer>
          </div>
        </Modal>
      )}

      {selection && !inquiryComposerOpen && (
        <div
          className="selection-tools"
          style={{ left: selection.left, top: selection.top }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="selection-tools-quote">
            <Quote size={13} />
            已选 {selection.text.length} 字
          </span>
          <button onClick={openInquiryComposer}>追问</button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(selection.text);
              setSelection(undefined);
            }}
          >
            复制
          </button>
          <button className="selection-tools-close" title="取消选区" onClick={() => setSelection(undefined)}>
            <X size={13} />
          </button>
        </div>
      )}

      {selection && inquiryComposerOpen && (
        <form
          className="inquiry-composer"
          style={{ left: selection.left, top: selection.top }}
          onSubmit={submitInquiry}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="inquiry-composer-quote">
            <Quote size={13} />
            <span>{selection.text}</span>
          </div>
          <textarea
            className="inquiry-draft"
            autoFocus
            value={inquiryDraft}
            onChange={(event) => setInquiryDraft(event.target.value)}
            placeholder="围绕选中内容追问…"
            rows={3}
          />
          <footer>
            <button
              type="button"
              onClick={() => {
                setInquiryDraft("");
                setInquiryComposerOpen(false);
                setSelection(undefined);
              }}
            >
              取消
            </button>
            <button className="primary" disabled={inquirySending || !inquiryDraft.trim()}>
              {inquirySending ? "发送中" : "开始追问"}
              <ChevronRight size={14} />
            </button>
          </footer>
        </form>
      )}

      {inquiryWindows.map(({ root, tree, source }, index) => {
        const position = windowPositions[root.id] ?? { x: -index * 26, y: -index * 26 };
        const activeNodeId = activeInquiryNodeIds[root.id];
        return (
          <aside
            key={root.id}
            className={`inquiry-focus-panel ${tree.some((node) => node.id === focusedInquiryId) ? "is-active" : ""}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            aria-label={`聚焦追问树：${root.summary}`}
            onMouseDown={() => focusInquiry(root.id)}
          >
            <header
              className="inquiry-focus-header"
              onPointerDown={(event) => handleInquiryPointerDown(root.id, event)}
              onPointerMove={handleInquiryPointerMove}
              onPointerUp={handleInquiryPointerUp}
            >
              <div>
                <span className="eyebrow">
                  聚焦探索 · {index + 1}/{inquiryWindows.length}
                </span>
                <strong>{root.summary}</strong>
              </div>
              <button
                title="关闭窗口"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => closeInquiry(root.id)}
              >
                <X size={16} />
              </button>
            </header>
            {source && (
              <div className="inquiry-focus-source">
                <Quote size={14} />
                <span>{root.focusSelection?.text}</span>
              </div>
            )}
            <InquiryMessageList
              tree={tree}
              rootId={root.id}
              activeNodeId={activeNodeId}
              showTimestamps={preferences.showTimestamps}
              onChooseNode={(node) => {
                setActiveInquiryNodeIds((current) => ({ ...current, [root.id]: node.id }));
                focusInquiry(node.id);
                selectNode(node.id);
              }}
            />
            <form
              className="inquiry-reply-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitInquiryReply(root.id, tree);
              }}
            >
              <div className="inquiry-reply-label">继续追问 · {activeNodeId ? "已选择节点" : "接着最近回复"}</div>
              <textarea
                value={inquiryReplyDrafts[root.id] ?? ""}
                onChange={(event) =>
                  setInquiryReplyDrafts((current) => ({ ...current, [root.id]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="继续在这棵树里追问…"
                rows={2}
              />
              <footer>
                <span>Enter 发送 · Shift+Enter 换行</span>
                <button
                  className="primary"
                  disabled={replySendingIds[root.id] || !(inquiryReplyDrafts[root.id] ?? "").trim()}
                >
                  {replySendingIds[root.id] ? "发送中" : "继续追问"}
                  <ChevronRight size={13} />
                </button>
              </footer>
            </form>
            <footer>
              <span>选区内容已固定为上下文</span>
              <button onClick={() => closeInquiry(root.id)}>关闭窗口</button>
            </footer>
          </aside>
        );
      })}

      <form
        className={`composer ${attachmentDragging ? "is-dragging" : ""}`}
        onSubmit={submit}
        onDragEnter={(event) => {
          event.preventDefault();
          if (activeAgent.tools.files) setAttachmentDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setAttachmentDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setAttachmentDragging(false);
          void addAttachments(event.dataTransfer.files);
        }}
      >
        {attachmentDragging && <div className="composer-drop-overlay">松开以上传文件</div>}
        {composerOptionsOpen && (
          <div className="composer-options" role="dialog" aria-label="本次消息设置">
            <div className="composer-options-heading">
              <strong>本次消息设置</strong>
              <span>沿用 Agent 默认值，可临时覆盖</span>
            </div>
            <div className="composer-option-group">
              <div className="composer-option-label">
                <Brain size={14} />
                <span>
                  <strong>思考强度</strong>
                  <small>关闭或控制模型推理预算</small>
                </span>
              </div>
              <div className="segmented-control composer-segmented-control">
                {(
                  [
                    ["default", "默认"],
                    ["none", "关闭"],
                    ["low", "低"],
                    ["medium", "中"],
                    ["high", "高"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={reasoningEffort === value ? "active" : ""}
                    onClick={() => setReasoningEffort(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="composer-option-row">
              <div className="composer-option-label">
                <Globe2 size={14} />
                <span>
                  <strong>联网搜索</strong>
                  <small>由桌面网关检索网页并注入当前请求</small>
                </span>
              </div>
              <button
                type="button"
                className={`composer-toggle ${webSearch ? "on" : ""}`}
                onClick={() => setWebSearch((value) => !value)}
                aria-pressed={webSearch}
              >
                <span />
                {webSearch ? "已开启" : "已关闭"}
              </button>
            </div>
            <label className="composer-prompt-field">
              <span>
                <strong>本次提示词</strong>
                <small>覆盖 Agent 的系统提示词，留空则使用默认提示词</small>
              </span>
              <textarea
                value={instructionsOverride}
                onChange={(event) => setInstructionsOverride(event.target.value)}
                rows={3}
                placeholder={activeAgent.instructions || "例如：用表格比较方案，并标注不确定性"}
              />
            </label>
          </div>
        )}
        <div className="composer-context">
          <span>
            <i style={{ backgroundColor: activeAgent.color }} />
            {activeAgent.name}
            <b>{activeAgent.modelId || "未选择模型"}</b>
          </span>
          <button type="button" title="预览发送给模型的上下文" onClick={() => setContextPreviewOpen(true)}>
            <ShieldAlert size={14} />
            {timeline.name} ·{" "}
            {timeline.contextMode === "until-node"
              ? "继承至分支点"
              : timeline.contextMode === "all"
                ? "继承全部"
                : "仅引用节点"}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault();
              void addAttachments(event.clipboardData.files);
            }
          }}
          onKeyDown={(event) => {
            const sendWithShortcut = event.key === "Enter" && (event.ctrlKey || event.metaKey);
            const sendWithPlainEnter = event.key === "Enter" && !event.shiftKey && preferences.sendWithEnter;
            if (sendWithShortcut || sendWithPlainEnter) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={`给 ${activeAgent.name} 发消息`}
          rows={3}
        />
        {(attachments.length > 0 || attachmentError) && (
          <div className="composer-attachments" aria-live="polite">
            {attachments.map((attachment) => (
              <div className="composer-attachment" key={attachment.id}>
                {attachment.mimeType.startsWith("image/") && attachment.dataUrl ? (
                  <img className="composer-attachment-preview" src={attachment.dataUrl} alt="" />
                ) : (
                  <span className="composer-attachment-icon"><Paperclip size={13} /></span>
                )}
                <span className="composer-attachment-copy">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <small>{formatAttachmentSize(attachment.size)} · {attachment.mimeType.split("/")[1] || "文件"}</small>
                </span>
                <button
                  type="button"
                  title={`移除 ${attachment.name}`}
                  aria-label={`移除 ${attachment.name}`}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {attachmentError && <span className="composer-attachment-error">{attachmentError}</span>}
          </div>
        )}
        <div className="composer-footer">
          <input
            ref={attachmentInputRef}
            className="composer-file-input"
            type="file"
            multiple
            onChange={(event) => {
              void addAttachments(event.target.files ?? []);
              event.currentTarget.value = "";
            }}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.mdx,.txt,.csv,.json,.jsonl,.xml,.yaml,.yml,.log,.ts,.tsx,.js,.jsx,.css,.html,.sql,.png,.jpg,.jpeg,.gif,.webp,.svg,audio/*,video/*"
          />
          <button
            type="button"
            className={`attach-button ${!activeAgent.tools.files ? "is-disabled" : ""}`}
            title={activeAgent.tools.files ? "添加附件" : "当前 Agent 未启用文件工具"}
            aria-label={activeAgent.tools.files ? "添加附件" : "当前 Agent 未启用文件工具"}
            onClick={() => void openAttachments()}
          >
            <Paperclip size={18} />
          </button>
          <span className="composer-status">
            {timeline.name} ·{" "}
            {workspaceMode === "remote"
              ? "云端 SSE 模式"
              : runtimeTarget === "desktop"
                ? "桌面本地 ModelGateway"
                : "模型服务未连接"}
            <em className={reasoningEffort === "none" ? "off" : ""}>
              <Brain size={11} />
              {reasoningEffort === "default"
                ? "思考默认"
                : reasoningEffort === "none"
                  ? "思考关闭"
                  : `思考${reasoningEffort === "low" ? "低" : reasoningEffort === "medium" ? "中" : "高"}`}
            </em>
            {webSearch && (
              <em>
                <Globe2 size={11} />
                联网
              </em>
            )}
          </span>
          <button
            type="button"
            className={`composer-options-trigger ${composerOptionsOpen ? "active" : ""}`}
            title="消息设置"
            aria-label="消息设置"
            aria-expanded={composerOptionsOpen}
            onClick={() => setComposerOptionsOpen((value) => !value)}
          >
            <Settings2 size={16} />
          </button>
          <button className="send-button" disabled={!draft.trim() || sending} title="发送消息">
            <ArrowUp size={18} />
          </button>
        </div>
      </form>

      {!mapOpen && (
        <button className="floating-map-button" onClick={() => setMapOpen(true)}>
          <GitBranch size={17} />
          <span>查看时间线地图</span>
        </button>
      )}

      {contextPreviewOpen && (
        <Modal title="发送前上下文预览" onClose={() => setContextPreviewOpen(false)} className="context-preview-modal">
          <div className="context-preview-intro">
            <span>{timeline.name}</span>
            <small>展示当前分支、系统提示词和本轮输入将组成的消息集合</small>
          </div>
          <div className="context-preview-list">
            {contextPreview.map((message, index) => (
              <article className={`context-preview-message ${message.kind}`} key={`${message.kind}-${message.sourceNodeId ?? index}`}>
                <header>
                  <strong>{message.kind === "system" ? "系统提示" : message.kind === "current" ? "本轮输入" : message.role === "user" ? "你" : activeAgent.name}</strong>
                  <span>{message.kind === "history" ? "历史上下文" : message.kind === "system" ? "发送时置于系统层" : "发送时追加"}</span>
                </header>
                <pre>{message.content}</pre>
              </article>
            ))}
          </div>
          <footer>
            <span className="context-preview-count">
              {contextPreview.length} 条消息 · 历史最多 80 条 / 120,000 字符
            </span>
            <button className="primary" onClick={() => setContextPreviewOpen(false)}>返回编辑</button>
          </footer>
        </Modal>
      )}

      {forkNodeId && (
        <Modal title="从历史消息创建分支" onClose={() => setForkNodeId(undefined)}>
          <div className="modal-content">
            <label>
              分支名称
              <input value={branchName} onChange={(event) => setBranchName(event.target.value)} autoFocus />
            </label>
            <fieldset>
              <legend>上下文继承方式</legend>
              {[
                ["until-node", "继承至此节点", "默认方式，保留分支点之前的有效上下文"],
                ["all", "继承全部", "适合继续同一问题，但会包含父线后续消息"],
                ["selected-only", "仅引用选中节点", "创建更干净的独立实验"],
              ].map(([value, title, detail]) => (
                <label className="radio-row" key={value}>
                  <input
                    type="radio"
                    checked={contextMode === value}
                    onChange={() => setContextMode(value as ContextMode)}
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <footer>
            <button className="secondary" onClick={() => setForkNodeId(undefined)}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => {
                forkFromNode(forkNodeId, branchName, contextMode);
                setForkNodeId(undefined);
              }}
            >
              创建并切换
            </button>
          </footer>
        </Modal>
      )}

      {threatNodeId && (
        <Modal title="标记威胁 / 风险" onClose={() => setThreatNodeId(undefined)}>
          <div className="modal-content">
            <label>
              风险标题
              <input value={threatTitle} onChange={(event) => setThreatTitle(event.target.value)} autoFocus />
            </label>
            <label>
              说明
              <textarea
                value={threatDetail}
                onChange={(event) => setThreatDetail(event.target.value)}
                rows={3}
                placeholder="这个节点会影响什么？"
              />
            </label>
            <div className="modal-field">
              <span>严重程度</span>
              <Select
                value={severity}
                options={[
                  { value: "low", label: "低", description: "记录并持续观察", color: "#3b8a6c" },
                  { value: "medium", label: "中", description: "可能影响当前方案", color: "#ce6d39" },
                  { value: "high", label: "高", description: "需要优先处理", color: "#b85240" },
                ]}
                onValueChange={(value) => setSeverity(value as Threat["severity"])}
                ariaLabel="风险严重程度"
              />
            </div>
          </div>
          <footer>
            <button className="secondary" onClick={() => setThreatNodeId(undefined)}>
              取消
            </button>
            <button
              className="danger"
              disabled={!threatTitle.trim()}
              onClick={() => {
                createThreat(threatNodeId, threatTitle, threatDetail, severity);
                setThreatNodeId(undefined);
              }}
            >
              创建风险
            </button>
          </footer>
        </Modal>
      )}

      {deleteNodeId &&
        (() => {
          const target = snapshot.nodes.find((node) => node.id === deleteNodeId);
          if (!target) return null;
          return (
            <Modal title="删除消息" onClose={() => setDeleteNodeId(undefined)}>
              <div className="modal-content">
                <p className="modal-warning">确定删除这条消息吗？它后面的子消息和关联的选区追问也会一并删除。</p>
                <div className="delete-message-preview">{target.summary || target.content.slice(0, 120)}</div>
              </div>
              <footer>
                <button className="secondary" disabled={deleteSaving} onClick={() => setDeleteNodeId(undefined)}>
                  取消
                </button>
                <button
                  className="danger"
                  disabled={deleteSaving}
                  onClick={async () => {
                    setDeleteSaving(true);
                    try {
                      await deleteMessage(deleteNodeId);
                      setDeleteNodeId(undefined);
                    } catch (error) {
                      setMessageActionError(
                        error instanceof Error && error.message ? error.message : "删除失败，请重试",
                      );
                    } finally {
                      setDeleteSaving(false);
                    }
                  }}
                >
                  {deleteSaving ? "删除中" : "删除消息"}
                </button>
              </footer>
            </Modal>
          );
        })()}
      {messageActionError && (
        <div className="sidebar-action-notice" role="status">
          <span>{messageActionError}</span>
          <button type="button" title="关闭提示" aria-label="关闭提示" onClick={() => setMessageActionError(undefined)}>
            ×
          </button>
        </div>
      )}
    </section>
  );
}
