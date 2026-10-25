import { describe, expect, it } from "vitest";
import { parseDocxXmlText } from "./docxText";

describe("parseDocxXmlText", () => {
  it("preserves paragraphs, tabs, line breaks, tables, and XML entities", () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>第一段 &amp; 内容</w:t><w:tab/><w:t>尾部</w:t></w:r></w:p>
          <w:p><w:r><w:t>第二段</w:t><w:br/><w:t>换行</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>字段</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>值</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body>
      </w:document>`;

    expect(parseDocxXmlText(xml)).toBe("第一段 & 内容\t尾部\n第二段\n换行\n字段\t值");
  });
});
