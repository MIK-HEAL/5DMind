const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // The EOCD record is at the end of a normal DOCX archive. The comment is
  // optional, so search backwards through the maximum legal comment range.
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function findDocumentEntry(bytes: Uint8Array): { localOffset: number; compressedSize: number; compression: number } | undefined {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) return undefined;
  const entryCount = readUint16(bytes, eocd + 10);
  const centralDirectoryOffset = readUint32(bytes, eocd + 16);
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
    if (readUint32(bytes, offset) !== 0x02014b50) break;
    const compression = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localOffset = readUint32(bytes, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === "word/document.xml") return { localOffset, compressedSize, compression };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前运行环境不支持 DOCX 解压");
  }
  const copy = Uint8Array.from(bytes);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (entity, name: string) => {
    if (name.toLowerCase() === "lt") return "<";
    if (name.toLowerCase() === "gt") return ">";
    if (name.toLowerCase() === "quot") return '"';
    if (name.toLowerCase() === "apos") return "'";
    if (name.toLowerCase() === "amp") return "&";
    const code = name.toLowerCase().startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

/** Extracts readable body text from WordprocessingML while keeping table cells readable. */
export function parseDocxXmlText(xml: string): string {
  const output: string[] = [];
  let inText = false;
  let tableCellDepth = 0;
  const tokens = /<!--[\s\S]*?-->|<[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(xml))) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      if (inText) output.push(decodeXmlEntities(token));
      continue;
    }
    const tag = token.match(/^<\s*(\/?)\s*([\w:.-]+)/);
    if (!tag) continue;
    const closing = Boolean(tag[1]);
    const name = tag[2].toLowerCase();
    if (closing) {
      if (name === "w:t") inText = false;
      if (name === "w:tc") {
        tableCellDepth = Math.max(0, tableCellDepth - 1);
        output.push("\t");
      }
      if (name === "w:tr" || name === "w:p") output.push("\n");
      if (name === "w:p" && tableCellDepth > 0) output.pop();
      continue;
    }
    if (name === "w:t") {
      inText = !token.trimEnd().endsWith("/>");
    } else if (name === "w:tc") {
      tableCellDepth += 1;
    } else if (name === "w:tab") {
      output.push("\t");
    } else if (name === "w:br" || name === "w:cr") {
      output.push("\n");
    } else if (token.trimEnd().endsWith("/>") && name === "w:p") {
      output.push("\n");
    }
  }
  return output
    .join("")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n")
    .trim();
}

export async function extractDocxText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entry = findDocumentEntry(bytes);
  if (!entry) throw new Error("DOCX 文件中缺少正文内容");
  const localOffset = entry.localOffset;
  if (readUint32(bytes, localOffset) !== 0x04034b50) throw new Error("DOCX 文件结构无效");
  const nameLength = readUint16(bytes, localOffset + 26);
  const extraLength = readUint16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  const xmlBytes = entry.compression === 0 ? compressed : entry.compression === 8 ? await inflateRaw(compressed) : undefined;
  if (!xmlBytes) throw new Error("DOCX 使用了不支持的压缩格式");
  const text = parseDocxXmlText(new TextDecoder("utf-8", { fatal: false }).decode(xmlBytes));
  if (!text) throw new Error("DOCX 中没有可提取的正文文本");
  return text.slice(0, 120_000);
}

export function isDocxAttachment(file: Pick<File, "name" | "type">): boolean {
  return file.type === DOCX_MIME_TYPE || /\.docx$/i.test(file.name);
}
