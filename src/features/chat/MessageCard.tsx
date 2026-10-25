import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  GitBranch,
  Layers2,
  Link2,
  MapPin,
  Merge,
  Pencil,
  Paperclip,
  Quote,
  RotateCcw,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import type { ConversationNode, Threat, Timeline } from "../../domain/types";
import { formatAttachmentSize } from "../../domain/attachments";
import { useSettings } from "../../state/SettingsProvider";
import { MessageMarkdown, ReasoningBlock, splitNodeContent } from "./MessageMarkdown";

interface MessageCardProps {
  node: ConversationNode;
  nodeTimeline?: Timeline;
  currentTimelineId: string;
  selected: boolean;
  threats: Threat[];
  onSelect: () => void;
  onFork: () => void;
  onThreat: () => void;
  onReference: () => void;
  onCompare: () => void;
  onDoubleClick?: () => void;
  timelineToolsEnabled: boolean;
  onEdit: (nodeId: string, content: string) => Promise<void>;
  onEditAndResend: (nodeId: string, content: string) => Promise<void>;
  onRetry: (nodeId: string) => Promise<void>;
  onDelete: () => void;
  inquiries: ConversationNode[];
  onSelectText: (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) => void;
  onOpenInquiry: (nodeId: string) => void;
}

function describeActionError(error: unknown, fallback: string) {
  const candidate = error as { message?: string; code?: string; status?: number; requestId?: string };
  const code = candidate.code ?? "MESSAGE_ACTION_FAILED";
  const details = [code, typeof candidate.status === "number" ? `HTTP ${candidate.status}` : "", candidate.requestId ? `请求 ID ${candidate.requestId}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `${details}：${candidate.message || fallback}`;
}

export function MessageCard({
  node,
  nodeTimeline,
  currentTimelineId,
  selected,
  threats,
  onSelect,
  onFork,
  onThreat,
  onReference,
  onCompare,
  onDoubleClick,
  timelineToolsEnabled,
  onEdit,
  onEditAndResend,
  onRetry,
  onDelete,
  inquiries,
  onSelectText,
  onOpenInquiry,
}: MessageCardProps) {
  const { preferences } = useSettings();
  const [copied, setCopied] = useState(false);
  const [inquiriesOpen, setInquiriesOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(node.content);
  const [editSaving, setEditSaving] = useState(false);
  const [editResending, setEditResending] = useState(false);
  const [editError, setEditError] = useState<string>();
  const inherited = node.timelineId !== currentTimelineId;
  const openThreats = threats.filter((threat) => threat.status === "open");
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(node.createdAt),
  );
  const role =
    node.kind === "user"
      ? (node.metadata.author ?? "你")
      : node.kind === "reference"
        ? "跨盘引用"
        : node.kind === "merge"
          ? "合并摘要"
          : (node.metadata.author ?? "5D 助手");
  const isUser = node.kind === "user";
  const { reasoning, answer } = splitNodeContent(node);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(node.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editDraft.trim() || editSaving) return;
    setEditError(undefined);
    setEditSaving(true);
    try {
      await onEdit(node.id, editDraft);
      setEditing(false);
    } catch (error) {
      setEditError(describeActionError(error, "保存失败，请重试"));
    } finally {
      setEditSaving(false);
    }
  };

  const submitEditAndResend = async () => {
    if (!editDraft.trim() || editSaving || editResending) return;
    setEditError(undefined);
    setEditResending(true);
    try {
      await onEditAndResend(node.id, editDraft);
      setEditing(false);
    } catch (error) {
      setEditError(describeActionError(error, "重新发送失败，请重试"));
    } finally {
      setEditResending(false);
    }
  };

  const actionBar = (
    <div className="message-actions" aria-label="消息操作">
      <button
        title={copied ? "已复制" : "复制消息"}
        aria-label={copied ? "已复制" : "复制消息"}
        onClick={(event) => {
          event.stopPropagation();
          void copyMessage();
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button
        title="在地图中定位"
        aria-label="在地图中定位"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <MapPin size={15} />
      </button>
      <button
        title="引用到当前线"
        aria-label="引用到当前线"
        disabled={!timelineToolsEnabled}
        onClick={(event) => {
          event.stopPropagation();
          onReference();
        }}
      >
        <Link2 size={15} />
      </button>
      <button
        title="从此处分支"
        aria-label="从此处分支"
        disabled={!timelineToolsEnabled}
        onClick={(event) => {
          event.stopPropagation();
          onFork();
        }}
      >
        <GitBranch size={15} />
      </button>
      <button
        title="标记风险"
        aria-label="标记风险"
        disabled={!timelineToolsEnabled}
        onClick={(event) => {
          event.stopPropagation();
          onThreat();
        }}
      >
        <AlertTriangle size={15} />
      </button>
      {!isUser && (
        <button
          title="添加双视角回复"
          aria-label="添加双视角回复"
          onClick={(event) => {
            event.stopPropagation();
            onCompare();
          }}
        >
          <UsersRound size={15} />
        </button>
      )}
      {isUser && !inherited && (
        <button
          title="编辑消息"
          aria-label="编辑消息"
          onClick={(event) => {
            event.stopPropagation();
            setEditDraft(node.content);
            setEditing(true);
          }}
        >
          <Pencil size={15} />
        </button>
      )}
      {!isUser && node.status === "failed" && !inherited && (
        <button
          title="重新生成"
          aria-label="重新生成"
          onClick={(event) => {
            event.stopPropagation();
            void onRetry(node.id).catch(() => undefined);
          }}
        >
          <RotateCcw size={15} />
        </button>
      )}
      {!inherited && node.status !== "streaming" && (
        <button
          className="message-action-danger"
          title="删除消息"
          aria-label="删除消息"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  return (
    <article
      className={`message-card ${node.kind} ${node.status} ${selected ? "selected" : ""}`}
      data-message-id={node.id}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {!isUser && (
        <div className={`message-avatar ${node.kind}`}>
          {node.kind === "reference" ? <Quote size={16} /> : node.kind === "merge" ? <Merge size={16} /> : "5D"}
        </div>
      )}
      <div className="message-body">
        <header>
          <div>
            <strong>{role}</strong>
            {preferences.showTimestamps && <span>{time}</span>}
            {inherited && <em>继承自 {nodeTimeline?.name ?? "父时间线"}</em>}
            {node.status === "streaming" && <em className="streaming">生成中</em>}
            {node.status === "failed" && <em className="failed">请求失败</em>}
          </div>
        </header>
        {node.kind === "reference" && (
          <div className="reference-source">
            <Link2 size={14} />
            来自 {node.metadata.boardName ?? "另一个盘面"}
          </div>
        )}
        {node.metadata.attachments?.length ? (
          <div className="message-attachments" aria-label="消息附件">
            {node.metadata.attachments.map((attachment) => (
              attachment.mimeType.startsWith("image/") && attachment.dataUrl ? (
                <a
                  className="message-image-attachment"
                  key={attachment.id}
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`查看 ${attachment.name}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <img src={attachment.dataUrl} alt={attachment.name} loading="lazy" decoding="async" />
                  <span>
                    <strong>{attachment.name}</strong>
                    <small>图片 · {formatAttachmentSize(attachment.size)}</small>
                  </span>
                </a>
              ) : (
                <span className="message-attachment" key={attachment.id} title={attachment.name}>
                  <Paperclip size={12} />
                  <strong>{attachment.name}</strong>
                  <small>{formatAttachmentSize(attachment.size)}</small>
                </span>
              )
            ))}
          </div>
        ) : null}
        {node.kind === "merge" && (
          <div className="merge-source">
            <Merge size={14} />
            保留 {node.sourceNodeIds?.length ?? 0} 个来源节点
          </div>
        )}
        {editing ? (
          <form
            className="message-edit-form"
            onSubmit={(event) => void submitEdit(event)}
            onClick={(event) => event.stopPropagation()}
          >
            <textarea
              autoFocus
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={Math.min(8, Math.max(3, editDraft.split(/\r?\n/).length))}
            />
            <div className="message-edit-meta">
              <span>{editError ? "发送失败，请检查后重试" : "修改后会生成新的回答版本，原回答仍会保留"}</span>
              <strong>{editDraft.length.toLocaleString()} 字</strong>
            </div>
            <footer>
              <span className={editError ? "message-edit-error" : undefined}>
                {editError ?? "Enter 保存 · Shift+Enter 换行"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditDraft(node.content);
                  setEditError(undefined);
                  setEditing(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={editSaving || editResending || !editDraft.trim()}
                onClick={() => void submitEditAndResend()}
              >
                {editResending ? "发送中" : "保存并重新发送"}
              </button>
              <button type="submit" disabled={editSaving || editResending || !editDraft.trim()}>
                {editSaving ? "保存中" : "仅保存"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="message-content" onMouseUp={onSelectText} onPointerUp={onSelectText}>
            {reasoning && <ReasoningBlock content={reasoning} streaming={node.status === "streaming"} />}
            <MessageMarkdown>{answer}</MessageMarkdown>
            {node.status === "streaming" && <span className="typing-caret" />}
          </div>
        )}
        {threats.length > 0 && (
          <div className="message-threats">
            {threats.map((threat) => (
              <span key={threat.id} className={`${threat.severity} ${threat.status}`}>
                <AlertTriangle size={13} />
                {threat.title}
                {threat.status === "resolved" ? " · 已解决" : ""}
              </span>
            ))}
          </div>
        )}
        {openThreats.length === 0 && node.metadata.tags?.length ? (
          <div className="message-tags">
            {node.metadata.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        {!editing && (
          <footer className="message-footer">
            {isUser && preferences.showTimestamps && <span>{time}</span>}
            {actionBar}
          </footer>
        )}
        {inquiries.length > 0 && (
          <div className={`inquiry-stack ${inquiriesOpen ? "is-open" : ""}`}>
            <button
              className="inquiry-stack-toggle"
              onClick={(event) => {
                event.stopPropagation();
                setInquiriesOpen((open) => !open);
              }}
              aria-expanded={inquiriesOpen}
            >
              <span className="inquiry-stack-icon">
                <Layers2 size={14} />
              </span>
              <span>
                <strong>{inquiries.length} 个选区追问</strong>
                <small>围绕这条消息继续探索</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {inquiriesOpen && (
              <div className="inquiry-stack-list">
                {inquiries.map((inquiry, index) => (
                  <button
                    key={inquiry.id}
                    className="inquiry-stack-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenInquiry(inquiry.id);
                    }}
                  >
                    <span className="inquiry-stack-index">{index + 1}</span>
                    <span>
                      <strong>{inquiry.summary}</strong>
                      <small>{inquiry.focusSelection?.text ?? "已保存选区"}</small>
                    </span>
                    <MapPin size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
