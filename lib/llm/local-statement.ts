import { FALLBACK_ROW_NOTE } from "@/lib/assistant/copy";
import type { Household } from "@/lib/chat/household";
import { householdInstructions, todayIso, withLocalStatementInstructions } from "@/lib/chat/prompts";
import { parseStatementFacts, textLooksUseful, type StatementReview } from "@/lib/chat/statement";
import type { ChatTurn, ReviewRow, StatementPage, StatementPageStatus } from "@/lib/chat/types";
import { reviewProposedRows } from "@/lib/chat/validate-rows";
import { checkImageCapability, type ImageCapability } from "./capabilities";
import { classifyPageText, extractPageTexts, renderStatementPage } from "./pdf-text";
import { runChatTurn } from "./run-turn";

export type ScanProgress = {
  page: number;
  total: number;
  model: string;
  textPages: number;
  scannedPages: number;
};

export type PageKind = "text" | "scanned" | "ocr" | "fallback" | "skipped" | "failed" | "unread";

export type PageOutcome = {
  page: number;
  kind: PageKind;
  text: string;
};

const OCR_PROMPT =
  "Transcribe this bank statement page. Return the text only, keeping every date, payee, and amount. Do not summarize.";

export type LocalStatementResult = {
  pages: PageOutcome[];
  statement: StatementReview;
  rows: ReviewRow[];
  proposalArgs: unknown | null;
};

export async function readLocalStatement(options: {
  bytes: Uint8Array;
  filename: string;
  baseUrl: string;
  model: string;
  ocrModel: string | null;
  instruction: string;
  messages: ChatTurn[];
  household: Household;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (event: ScanProgress) => void;
  extractTexts?: (bytes: Uint8Array) => Promise<string[]>;
  renderPage?: (bytes: Uint8Array, pageNumber: number) => Promise<Uint8Array>;
  checkVision?: (model: string) => Promise<ImageCapability>;
}): Promise<LocalStatementResult> {
  throwIfAborted(options.signal);
  const extract = options.extractTexts ?? extractPageTexts;
  const render = options.renderPage ?? renderStatementPage;
  const visionOf =
    options.checkVision ??
    ((model: string) =>
      checkImageCapability({ baseUrl: options.baseUrl, model, fetchImpl: options.fetchImpl }));
  const texts = await extract(options.bytes);
  const pages: PageOutcome[] = texts.map((text, index) => ({
    page: index + 1,
    kind: classifyPageText(text) === "text" ? "text" : "scanned",
    text: classifyPageText(text) === "text" ? text : "",
  }));
  const scanned = pages.filter((page) => page.kind === "scanned");
  const textCount = pages.length - scanned.length;

  if (scanned.length > 0) {
    await readScannedPages({
      pages: scanned,
      textCount,
      bytes: options.bytes,
      baseUrl: options.baseUrl,
      model: options.model,
      ocrModel: options.ocrModel,
      fetchImpl: options.fetchImpl ?? fetch,
      signal: options.signal,
      onProgress: options.onProgress,
      render,
      visionOf,
    });
  }

  const combined = pages
    .filter((page) => page.text.trim())
    .map((page) => `--- page ${page.page} (${page.kind}) ---\n${page.text.trim()}`)
    .join("\n\n");
  const facts = parseStatementFacts(combined);
  const statement = toStatement(pages, facts);
  if (!combined.trim()) {
    return { pages, statement, rows: [], proposalArgs: null };
  }

  throwIfAborted(options.signal);
  const turn = await runChatTurn({
    apiKey: "",
    assistant: { type: "local", baseUrl: options.baseUrl, model: options.model, ocrModel: options.ocrModel },
    instructions: withLocalStatementInstructions(
      householdInstructions({
        currency: options.household.currency,
        categories: options.household.categories,
        banks: options.household.banks,
        today: todayIso(),
      }),
    ),
    messages: [
      ...options.messages,
      {
        role: "user",
        content: `${options.instruction.trim()}\n\nStatement text read on this computer:\n\n${combined}`,
      },
    ],
    mode: "pdf",
    fetchImpl: options.fetchImpl,
    executeTool: (name) => {
      if (name === "propose_transactions") return { ok: true, saved: false };
      return { ok: false, error: "Only propose_transactions is available for a statement." };
    },
  });
  const fallbackText = pages
    .filter((page) => page.kind === "fallback")
    .map((page) => page.text)
    .join("\n");
  const rows = markFallback(
    reviewProposedRows(rowsFrom(turn.proposalArgs), {
      categories: options.household.categories,
      banks: options.household.banks,
      existing: options.household.existing,
    }),
    fallbackText,
  );
  return { pages, statement, rows, proposalArgs: turn.proposalArgs };
}

async function readScannedPages(options: {
  pages: PageOutcome[];
  textCount: number;
  bytes: Uint8Array;
  baseUrl: string;
  model: string;
  ocrModel: string | null;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (event: ScanProgress) => void;
  render: (bytes: Uint8Array, pageNumber: number) => Promise<Uint8Array>;
  visionOf: (model: string) => Promise<ImageCapability>;
}): Promise<void> {
  let chatVision: ImageCapability | null = null;
  const chatCanSee = async () => {
    if (!chatVision) chatVision = await options.visionOf(options.model);
    return chatVision.status === "ready";
  };

  if (!options.ocrModel) {
    if (!(await chatCanSee())) {
      for (const page of options.pages) page.kind = "skipped";
      return;
    }
  }

  let failed = false;
  for (let index = 0; index < options.pages.length; index += 1) {
    const page = options.pages[index];
    if (!page) continue;
    throwIfAborted(options.signal);
    if (failed) {
      page.kind = "unread";
      continue;
    }
    const reader = options.ocrModel ?? options.model;
    options.onProgress?.({
      page: index + 1,
      total: options.pages.length,
      model: reader,
      textPages: options.textCount,
      scannedPages: options.pages.length,
    });
    let image: Uint8Array;
    try {
      image = await options.render(options.bytes, page.page);
    } catch {
      page.kind = "failed";
      failed = true;
      continue;
    }
    if (options.ocrModel) {
      const ocrText = await readImage({
        baseUrl: options.baseUrl,
        model: options.ocrModel,
        image,
        fetchImpl: options.fetchImpl,
        signal: options.signal,
      });
      if (textLooksUseful(ocrText)) {
        page.kind = "ocr";
        page.text = ocrText;
        continue;
      }
      if (await chatCanSee()) {
        const fallback = await readImage({
          baseUrl: options.baseUrl,
          model: options.model,
          image,
          fetchImpl: options.fetchImpl,
          signal: options.signal,
        });
        if (textLooksUseful(fallback)) {
          page.kind = "fallback";
          page.text = fallback;
          continue;
        }
      }
      page.kind = "failed";
      failed = true;
      continue;
    }
    const seen = await readImage({
      baseUrl: options.baseUrl,
      model: options.model,
      image,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    if (textLooksUseful(seen)) {
      page.kind = "ocr";
      page.text = seen;
      continue;
    }
    page.kind = "failed";
    failed = true;
  }
}

async function readImage(options: {
  baseUrl: string;
  model: string;
  image: Uint8Array;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<string> {
  try {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const { generateText } = await import("ai");
    const provider = createOpenAICompatible({
      name: "local",
      baseURL: options.baseUrl,
      fetch: options.fetchImpl,
    });
    const result = await generateText({
      model: provider.chatModel(options.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "file", mediaType: "image/png", data: options.image },
          ],
        },
      ],
      providerOptions: { local: { reasoningEffort: "none" } },
      maxRetries: 0,
      abortSignal: options.signal,
      timeout: { totalMs: 120_000 },
    });
    return result.text ?? "";
  } catch (error) {
    if (isAbort(error)) throw error;
    return "";
  }
}

function markFallback(rows: ReviewRow[], fallbackText: string): ReviewRow[] {
  const haystack = fallbackText.toLowerCase();
  if (!haystack.trim()) return rows;
  return rows.map((row) => {
    const needle = row.description.trim().toLowerCase();
    if (needle.length < 4 || !haystack.includes(needle)) return row;
    const flags = row.flags.includes("uncertain") ? row.flags : [...row.flags, "uncertain"];
    return { ...row, flags, note: FALLBACK_ROW_NOTE };
  });
}

function rowsFrom(args: unknown): unknown[] {
  if (typeof args !== "object" || args === null || !("rows" in args)) return [];
  const rows = (args as { rows: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

function toStatement(
  pages: PageOutcome[],
  facts: ReturnType<typeof parseStatementFacts>,
): StatementReview {
  const view: StatementPage[] = pages.map((page) => ({ page: page.page, status: viewStatus(page.kind) }));
  const failed = pages.find((page) => page.kind === "failed");
  const skipped = pages.some((page) => page.kind === "skipped");
  const bothBalances = facts.opening !== null && facts.closing !== null && !failed && !skipped;
  return {
    account: facts.account,
    periodStart: facts.periodStart,
    periodEnd: facts.periodEnd,
    pageCount: pages.length,
    pages: view,
    textPages: pages.filter((page) => page.kind === "text").map((page) => page.page),
    scannedPages: pages.filter((page) => page.kind !== "text").map((page) => page.page),
    skippedPages: pages.filter((page) => page.kind === "skipped").map((page) => page.page),
    failedPage: failed?.page ?? null,
    opening: bothBalances ? facts.opening : null,
    closing: bothBalances ? facts.closing : null,
  };
}

function viewStatus(kind: PageKind): StatementPageStatus {
  if (kind === "failed") return "failed";
  if (kind === "unread") return "unread";
  if (kind === "skipped" || kind === "scanned") return "skipped";
  return "read";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Cancelled");
  error.name = "AbortError";
  throw error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
