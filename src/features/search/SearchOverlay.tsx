import { MessageSquareText, Search, Waypoints, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  searchWorkspace,
  type NodeSearchMatch,
  type WorkspaceSearchResults,
} from "../../domain/selectors";
import { useWorkspace } from "../../state/WorkspaceProvider";

type SearchScope = "all" | "current";

interface BaseItem {
  key: string;
}

interface ConversationItem extends BaseItem {
  type: "conversation";
  id: string;
  title: string;
}

interface TimelineItem extends BaseItem {
  type: "timeline";
  id: string;
  name: string;
  conversationTitle?: string;
}

interface NodeItem extends BaseItem {
  type: "node";
  match: NodeSearchMatch;
}

type SearchResultItem = ConversationItem | TimelineItem | NodeItem;

const KIND_BADGES: Record<string, string> = {
  user: "你",
  assistant: "AI",
  system: "系统",
  reference: "引用",
  merge: "合并",
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });

/** Splits text into highlighted / plain segments for the given query. */
function highlight(text: string, query: string): ReactNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [text];
  const haystack = text.toLocaleLowerCase();
  const segments: ReactNode[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle);
  let key = 0;
  while (index !== -1 && index < text.length) {
    if (index > cursor) segments.push(text.slice(cursor, index));
    segments.push(
      <mark key={`hl-${key++}`} className="search-highlight">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments;
}

function toItems(results: WorkspaceSearchResults, scope: SearchScope): SearchResultItem[] {
  const conversations: ConversationItem[] =
    scope === "all"
      ? results.conversations.map((match) => ({
          type: "conversation" as const,
          key: `conversation-${match.conversation.id}`,
          id: match.conversation.id,
          title: match.conversation.title,
        }))
      : [];
  const timelines: TimelineItem[] = results.timelines.map((match) => ({
    type: "timeline" as const,
    key: `timeline-${match.timeline.id}`,
    id: match.timeline.id,
    name: match.timeline.name,
    conversationTitle: match.conversation?.title,
  }));
  const nodes: NodeItem[] = results.nodes.map((match) => ({
    type: "node" as const,
    key: `node-${match.node.id}`,
    match,
  }));
  return [...conversations, ...timelines, ...nodes];
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="search-section-header">
      <span>{label}</span>
      <small>{count}</small>
    </div>
  );
}

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { snapshot, switchConversation, switchTimeline, selectNode } = useWorkspace();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => searchWorkspace(snapshot, deferredQuery, { scope, limit: 60 }),
    [snapshot, deferredQuery, scope],
  );
  const items = useMemo(() => toItems(results, scope), [results, scope]);
  const active = items.length ? Math.min(activeIndex, items.length - 1) : 0;

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const jump = useCallback(
    (item: SearchResultItem) => {
      if (item.type === "conversation") {
        switchConversation(item.id);
      } else if (item.type === "timeline") {
        switchTimeline(item.id);
      } else {
        const { node } = item.match;
        selectNode(node.id);
        window.setTimeout(() => {
          document
            .querySelector(`[data-message-id="${node.id}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 140);
      }
      onClose();
    },
    [onClose, selectNode, switchConversation, switchTimeline],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((active + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((active - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) jump(item);
    }
  };

  const hasQuery = deferredQuery.trim().length > 0;

  return (
    <div
      className="search-overlay-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="search-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="search-overlay-header">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索消息、对话、时间线…"
            aria-label="搜索工作区"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="search-scope-toggle" role="group" aria-label="搜索范围">
            <button
              type="button"
              className={scope === "all" ? "active" : ""}
              onClick={() => setScope("all")}
            >
              全部对话
            </button>
            <button
              type="button"
              className={scope === "current" ? "active" : ""}
              onClick={() => setScope("current")}
            >
              当前对话
            </button>
          </div>
          <button type="button" className="search-close-button" title="关闭 (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="search-overlay-body" ref={listRef}>
          {!hasQuery && (
            <p className="search-hint">
              输入关键词检索全部消息内容、思考过程、对话标题与时间线名称。
              <br />
              <kbd>↑</kbd> <kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 跳转 · <kbd>Esc</kbd> 关闭
            </p>
          )}

          {hasQuery && !items.length && <p className="search-hint">没有找到与“{deferredQuery.trim()}”匹配的结果</p>}

          {hasQuery && items.length > 0 && (
            <>
              {scope === "all" && results.conversations.length > 0 && (
                <>
                  <SectionHeader label="对话" count={results.conversations.length} />
                  {items
                    .filter((item): item is ConversationItem => item.type === "conversation")
                    .map((item) => {
                      const index = items.indexOf(item);
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`search-row ${index === active ? "is-active" : ""}`}
                          data-search-index={index}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => jump(item)}
                        >
                          <span className="search-row-icon">
                            <MessageSquareText size={15} />
                          </span>
                          <span className="search-row-copy">
                            <strong>{highlight(item.title, deferredQuery)}</strong>
                            <small>切换到该对话</small>
                          </span>
                        </button>
                      );
                    })}
                </>
              )}

              {results.timelines.length > 0 && (
                <>
                  <SectionHeader label="时间线" count={results.timelines.length} />
                  {items
                    .filter((item): item is TimelineItem => item.type === "timeline")
                    .map((item) => {
                      const index = items.indexOf(item);
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`search-row ${index === active ? "is-active" : ""}`}
                          data-search-index={index}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => jump(item)}
                        >
                          <span className="search-row-icon">
                            <Waypoints size={15} />
                          </span>
                          <span className="search-row-copy">
                            <strong>{highlight(item.name, deferredQuery)}</strong>
                            <small>{item.conversationTitle ?? "所属对话"}</small>
                          </span>
                        </button>
                      );
                    })}
                </>
              )}

              {results.nodes.length > 0 && (
                <>
                  <SectionHeader
                    label="消息"
                    count={results.totalNodeMatches > results.nodes.length ? results.totalNodeMatches : results.nodes.length}
                  />
                  {items
                    .filter((item): item is NodeItem => item.type === "node")
                    .map((item) => {
                      const index = items.indexOf(item);
                      const { node, timeline, conversation, snippet, matchedField, matchCount } = item.match;
                      const badge = KIND_BADGES[node.kind] ?? node.kind;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`search-row search-row-node ${index === active ? "is-active" : ""}`}
                          data-search-index={index}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => jump(item)}
                        >
                          <span className="search-row-badge">{badge}</span>
                          <span className="search-row-copy">
                            <strong className="search-snippet">
                              {highlight(snippet.before, deferredQuery)}
                              {snippet.match && <mark className="search-highlight">{snippet.match}</mark>}
                              {highlight(snippet.after, deferredQuery)}
                            </strong>
                            <small>
                              {timeline?.name ?? node.timelineId}
                              {conversation && scope === "all" ? ` · ${conversation.title}` : ""}
                              {matchedField === "reasoning" ? " · 思考过程" : ""}
                              {matchCount > 1 ? ` · ${matchCount} 处` : ""}
                              {` · ${dateFormat.format(new Date(node.createdAt))}`}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                </>
              )}

              {results.totalNodeMatches > results.nodes.length && (
                <p className="search-more">
                  消息共 {results.totalNodeMatches} 处匹配，已按相关度显示前 {results.nodes.length} 条，可输入更精确的关键词缩小范围。
                </p>
              )}
            </>
          )}
        </div>

        <footer className="search-overlay-footer">
          <span>
            {hasQuery
              ? `${results.totalNodeMatches + results.conversations.length + results.timelines.length} 项匹配`
              : "全局搜索"}
          </span>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 跳转 · <kbd>Esc</kbd> 关闭
          </span>
        </footer>
      </section>
    </div>
  );
}
