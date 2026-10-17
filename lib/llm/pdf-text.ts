import { pageHasUsableText } from "@/lib/chat/statement";

/** Text layer of every page, in order. One unpdf/pdf.js pass, not one call per page. */
export async function extractPageTexts(data: Uint8Array): Promise<string[]> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(data), { mergePages: false });
  return result.text.map((page) => page ?? "");
}

/** Render one page to a PNG for the OCR model. The capability check never calls this. */
export async function renderStatementPage(data: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const image = await renderPageAsImage(pdf, pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: 1.5,
  });
  return new Uint8Array(image);
}

export function classifyPageText(text: string): "text" | "scanned" {
  return pageHasUsableText(text) ? "text" : "scanned";
}
