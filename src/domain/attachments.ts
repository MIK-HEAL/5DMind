export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Text files are made available to the model as a bounded excerpt. */
  textContent?: string;
  /** Binary payload used by providers that support inline data. */
  dataUrl?: string;
}

export interface AttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
  dataUrl?: string;
}

export const MAX_ATTACHMENT_COUNT = 5;
export const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_SIZE = 24 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 120_000;

export function attachmentMetadata(attachment: MessageAttachment): AttachmentMetadata {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType || "application/octet-stream",
    size: attachment.size,
    ...(attachment.textContent !== undefined ? { textContent: attachment.textContent } : {}),
    ...(attachment.dataUrl ? { dataUrl: attachment.dataUrl } : {}),
  };
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isTextAttachment(file: Pick<File, "type" | "name">): boolean {
  return file.type.startsWith("text/") || /\.(md|mdx|txt|csv|json|jsonl|xml|yaml|yml|log|ts|tsx|js|jsx|css|html|sql)$/i.test(file.name);
}
