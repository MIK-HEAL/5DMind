import { AlertTriangle, Check, ChevronDown, Copy, GitBranch, Layers2, Link2, MapPin, Merge, Quote } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useState, type MouseEvent, type PointerEvent } from "react";
import type { ConversationNode, Threat, Timeline } from "../../domain/types";
import { useSettings } from "../../state/SettingsProvider";

const markdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {children}
    </a>
  ),
  pre: ({ node: _node, children, ...props }) => <pre {...props} className="markdown-code-block">{children}</pre>,
  code: ({ node: _node, className, children, ...props }) => (
    <code {...props} className={className ? `markdown-code ${className}` : "markdown-code-inline"}>
      {children}
    </code>
  ),
  table: ({ node: _node, children, ...props }) => <div className="markdown-table-wrap"><table {...props}>{children}</table></div>,
};

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
  inquiries: ConversationNode[];
  onSelectText: (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) => void;
  onOpenInquiry: (nodeId: string) => void;
}

export function MessageCard({
  node, nodeTimeline, currentTimelineId, selected, threats, onSelect, onFork, onThreat, onReference,
  inquiries, onSelectText, onOpenInquiry,
}: MessageCardProps) {
  const { preferences } = useSettings();
  const [copied, setCopied] = useState(false);
  const [inquiriesOpen, setInquiriesOpen] = useState(false);
  const inherited = node.timelineId !== currentTimelineId;
  const openThreats = threats.filter((threat) => threat.status === "open");
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(node.createdAt));
  const role = node.kind === "user" ? node.metadata.author ?? "你" : node.kind === "reference" ? "跨盘引用" : node.kind === "merge" ? "合并摘要" : node.metadata.author ?? "5D 助手";
  const isUser = node.kind === "user";

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(node.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const actionBar = (
    <div className="message-actions" aria-label="消息操作">
      <button title={copied ? "已复制" : "复制消息"} aria-label={copied ? "已复制" : "复制消息"} onClick={(event) => { event.stopPropagation(); void copyMessage(); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
      <button title="在地图中定位" aria-label="在地图中定位" onClick={(event) => { event.stopPropagation(); onSelect(); }}><MapPin size={15} /></button>
      <button title="引用到当前线" aria-label="引用到当前线" onClick={(event) => { event.stopPropagation(); onReference(); }}><Link2 size={15} /></button>
      <button title="从此处分支" aria-label="从此处分支" onClick={(event) => { event.stopPropagation(); onFork(); }}><GitBranch size={15} /></button>
      <button title="标记风险" aria-label="标记风险" onClick={(event) => { event.stopPropagation(); onThreat(); }}><AlertTriangle size={15} /></button>
    </div>
  );

  return (
    <article
      className={`message-card ${node.kind} ${node.status} ${selected ? "selected" : ""}`}
      data-message-id={node.id}
      onClick={onSelect}
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
          <div className="reference-source"><Link2 size={14} />来自 {node.metadata.boardName ?? "另一个盘面"}</div>
        )}
        {node.kind === "merge" && (
          <div className="merge-source"><Merge size={14} />保留 {node.sourceNodeIds?.length ?? 0} 个来源节点</div>
        )}
        <div className="message-content" onMouseUp={onSelectText} onPointerUp={onSelectText}>
          <Markdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeSanitize]}
            components={markdownComponents}
          >
            {node.content}
          </Markdown>
          {node.status === "streaming" && <span className="typing-caret" />}
        </div>
        {threats.length > 0 && (
          <div className="message-threats">
            {threats.map((threat) => (
              <span key={threat.id} className={`${threat.severity} ${threat.status}`}>
                <AlertTriangle size={13} />{threat.title}{threat.status === "resolved" ? " · 已解决" : ""}
              </span>
            ))}
          </div>
        )}
        {openThreats.length === 0 && node.metadata.tags?.length ? (
          <div className="message-tags">{node.metadata.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        ) : null}
        <footer className="message-footer">
          {isUser && preferences.showTimestamps && <span>{time}</span>}
          {actionBar}
        </footer>
        {inquiries.length > 0 && (
          <div className={`inquiry-stack ${inquiriesOpen ? "is-open" : ""}`}>
            <button
              className="inquiry-stack-toggle"
              onClick={(event) => { event.stopPropagation(); setInquiriesOpen((open) => !open); }}
              aria-expanded={inquiriesOpen}
            >
              <span className="inquiry-stack-icon"><Layers2 size={14} /></span>
              <span><strong>{inquiries.length} 个选区追问</strong><small>围绕这条消息继续探索</small></span>
              <ChevronDown size={14} />
            </button>
            {inquiriesOpen && (
              <div className="inquiry-stack-list">
                {inquiries.map((inquiry, index) => (
                  <button
                    key={inquiry.id}
                    className="inquiry-stack-item"
                    onClick={(event) => { event.stopPropagation(); onOpenInquiry(inquiry.id); }}
                  >
                    <span className="inquiry-stack-index">{index + 1}</span>
                    <span><strong>{inquiry.summary}</strong><small>{inquiry.focusSelection?.text ?? "已保存选区"}</small></span>
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
