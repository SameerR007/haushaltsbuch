/** A small text PDF. Empty strings become pages with no text layer (scanned). */

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildStatementPdf(pages: readonly string[]): Uint8Array {
  const chunks: string[] = [];
  let length = 0;
  const push = (text: string) => {
    chunks.push(text);
    length += text.length;
  };
  push("%PDF-1.4\n");
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0);
    const commands = ["BT", "/F1 11 Tf", "48 760 Td", "14 TL"];
    for (const line of lines) commands.push(`(${pdfEscape(line)}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const xref: number[] = [0];
  for (let id = 1; id <= fontId; id += 1) {
    xref[id] = length;
    push(`${id} 0 obj\n${objects[id] ?? "<<>>"}\nendobj\n`);
  }
  const xrefStart = length;
  push(`xref\n0 ${fontId + 1}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id <= fontId; id += 1) {
    push(`${String(xref[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return new TextEncoder().encode(chunks.join(""));
}
