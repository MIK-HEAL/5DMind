import {
  ArrowUp,
  Bot,
  Brain,
  ChevronRight,
  GitBranch,
  Globe2,
  Paperclip,
  Quote,
  Settings2,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import { Select } from "../../components/ui/Select";
import type { ContextMode, ConversationNode, FocusSelection, Threat } from "../../domain/types";
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

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
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
    deleteMessage,
  } = useWorkspace();
  const { activeAgent, preferences } = useSettings();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [forkNodeId, setForkNodeId] = useState<string>();
  const [threatNodeId, setThreatNodeId] = useState<string>();
  const [deleteNodeId, setDeleteNodeId] = useState<string>();
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [messageActionError, setMessageActionError] = useState<string>();
  const [branchName, setBranchName] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>("until-node");
  const [threatTitle, setThreatTitle] = useState("");
  const [threatDetail, setThreatDetail] = useState("");
  const [severity, setSeverity] = useState<Threat["severity"]>("medium");
  const [selection, setSelection] = useState<SelectionState>();
  const [inquiryDraft, setInquiryDraft] = useState("");
  const [inquiryComposerOpen, setInquiryComposerOpen] = useState(false);
  const [inquirySending, setInquirySending] = useState(false);
  const [inquiryReplyDrafts, setInquiryReplyDrafts] = useState<Record<string, string>>({});
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
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
    () => getTimelineNodes(snapshot, timeline.id).filter((node) => !isFocusedInquiry(node)),
    [snapshot, timeline.id],
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
      });
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setSending(false);
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
              onEdit={updateMessage}
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
        <div ref={endRef} />
      </div>

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

      <form className="composer" onSubmit={submit}>
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
          <button type="button" title="上下文模式">
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
        <div className="composer-footer">
          <button type="button" className="attach-button" title="附件将在下一阶段开放">
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
