export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const PDF_TOO_LARGE = "That PDF is larger than 25 MB. Attach a smaller statement.";

export const PDF_NOT_PDF = "Attach a PDF bank statement.";

/** Page count from the PDF structure. This does not extract statement text. */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const tree = /\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/.exec(text);
  if (tree) {
    const count = Number(tree[1]);
    if (Number.isInteger(count) && count > 0 && count < 10_000) return count;
  }
  const pages = text.match(/\/Type\s*\/Page(?!s)\b/g);
  if (pages && pages.length > 0 && pages.length < 10_000) return pages.length;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function attachmentLabel(name: string, pages: number | null, size: number): string {
  const parts = [name];
  if (pages && pages > 0) parts.push(`${pages} ${pages === 1 ? "page" : "pages"}`);
  const sizeLabel = formatFileSize(size);
  if (sizeLabel) parts.push(sizeLabel);
  return parts.join(" · ");
}

export function safePdfName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() || "statement.pdf";
  const clipped = base.slice(0, 120);
  if (!clipped) return "statement.pdf";
  return clipped.toLowerCase().endsWith(".pdf") ? clipped : `${clipped}.pdf`;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
