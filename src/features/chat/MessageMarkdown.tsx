import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Children, isValidElement, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import type { ConversationNode } from "../../domain/types";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

export function splitReasoning(content: string) {
  let reasoning = "";
  const answer = content.replace(
    /<(?:think|thinking|thought)>[\s\S]*?(?:<\/(?:think|thinking|thought)>|$)/gi,
    (block) => {
      reasoning += block.replace(/^<(?:think|thinking|thought)>/i, "").replace(/<\/(?:think|thinking|thought)>$/i, "");
      return "";
    },
  );
  return { reasoning: reasoning.trim(), answer: answer.trim() };
}

// Models often emit LaTeX display delimiters as `\[`/`\]`. Markdown treats
// those backslashes as escapes before remark-math sees them, so normalize both
// forms to the $$ syntax understood by remark-math. Standalone bracket lines
// are included for older messages that already lost the backslashes.
function normalizeMathDelimiters(content: string) {
  const lines = content.split(/\r?\n/);
  let inDisplay = false;
  const normalized: string[] = [];
  for (const line of lines) {
    const marker = line.trim();
    if (!inDisplay && (marker === "\\[" || marker === "[")) {
      normalized.push("$$");
      inDisplay = true;
    } else if (inDisplay && (marker === "\\]" || marker === "]")) {
      normalized.push("$$");
      inDisplay = false;
    } else {
      normalized.push(line);
    }
  }
  return normalized.join("\n").replace(/\\\(([^\n]+?)\\\)/g, "$$$1$$");
}

export function splitNodeContent(node: Pick<ConversationNode, "content" | "metadata">) {
  const split = splitReasoning(node.content);
  const reasoning = [node.metadata.reasoning, split.reasoning].filter(Boolean).join("\n\n").trim();
  return { reasoning, answer: split.answer };
}

export function ReasoningBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const [wasStreaming, setWasStreaming] = useState(streaming);
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming);
    if (streaming) setOpen(true);
  }
  return (
    <section className={`message-reasoning ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="message-reasoning-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="message-reasoning-mark" aria-hidden="true">
          ✦
        </span>
        <span className="message-reasoning-label">{streaming ? "正在思考" : "思考过程"}</span>
        <span className="message-reasoning-meta">{streaming ? "实时生成" : `${content.length} 字`}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="message-reasoning-content">
          <MessageMarkdown>{content}</MessageMarkdown>
        </div>
      )}
    </section>
  );
}

function MarkdownCodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(code) ? code.props.className : undefined;
  const language = className?.match(/language-([\w-]+)/)?.[1] ?? "代码";
  const value = textContent(isValidElement<{ children?: ReactNode }>(code) ? code.props.children : children);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="markdown-code-shell">
      <div className="markdown-code-toolbar">
        <span className="markdown-code-language">{language}</span>
        <button
          type="button"
          className="markdown-code-copy"
          onClick={(event) => {
            event.stopPropagation();
            void copyCode();
          }}
          aria-label={copied ? "代码已复制" : "复制代码"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre {...props} className="markdown-code-block">
        {children}
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {children}
    </a>
  ),
  pre: ({ node: _node, ...props }) => <MarkdownCodeBlock {...props} />,
  code: ({ node: _node, className, children, ...props }) => (
    <code {...props} className={className ? `markdown-code ${className}` : "markdown-code-inline"}>
      {children}
    </code>
  ),
  table: ({ node: _node, children, ...props }) => (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
  img: ({ node: _node, alt, ...props }) => (
    <img {...props} alt={alt ?? "Markdown 图片"} loading="lazy" decoding="async" className="markdown-image" />
  ),
};

export function MessageMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeSanitize, rehypeKatex]}
      components={markdownComponents}
    >
      {normalizeMathDelimiters(children)}
    </Markdown>
  );
}
