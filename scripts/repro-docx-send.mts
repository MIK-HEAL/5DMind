// 复现脚本：模拟前端"选择 docx → 发送消息"链路，验证 POST /turns 是否仍被拒绝。
// 运行：npx tsx scripts/repro-docx-send.mts（API 服务需已在 localhost:3000 启动）
import { readFile } from "node:fs/promises";
import { extractDocxText } from "../src/infrastructure/docxText.js";

const BASE = "http://localhost:3000/api/v1";
const DOCX_PATH = new URL("../docs_upload_parse_test.docx", import.meta.url);

const bytes = await readFile(DOCX_PATH);
const file = new File([bytes], "docs_upload_parse_test.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// 与前端 readAttachment() 完全相同的提取路径
const textContent = await extractDocxText(file);
console.log(`docx 文本提取成功：${textContent.length} 字符`);

const attachment = {
  id: `${file.name}-${file.size}-${file.lastModified}`,
  name: file.name,
  mimeType: file.type,
  size: file.size,
  textContent,
};

async function main() {
  const convRes = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ title: "docx 复现" }),
  });
  if (!convRes.ok) throw new Error(`创建会话失败: HTTP ${convRes.status}`);
  const conversation = await convRes.json();

  const graphRes = await fetch(`${BASE}/conversations/${conversation.id}/graph`);
  const graph = await graphRes.json();
  const timeline = graph.timelines[0];

  const turnRes = await fetch(`${BASE}/timelines/${timeline.id}/turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      content: "请阅读附件内容",
      clientMessageId: `node-${crypto.randomUUID()}`,
      attachments: [attachment],
    }),
  });
  const turnBody = await turnRes.text();
  console.log(`POST /turns → HTTP ${turnRes.status}`);
  console.log(turnBody.slice(0, 500));

  if (turnRes.ok) {
    const { eventsUrl } = JSON.parse(turnBody);
    const absolute = eventsUrl.startsWith("http")
      ? eventsUrl
      : `http://localhost:3000${eventsUrl}`;
    const sseRes = await fetch(absolute);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sse = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += decoder.decode(value, { stream: true });
      if (sse.includes("message.completed") || sse.includes("message.failed")) break;
    }
    console.log("--- SSE 事件（截断）---");
    console.log(sse.slice(0, 800));
  }
}

main().catch((error) => {
  console.error("复现脚本报错:", error);
  process.exitCode = 1;
});
