/** Plain-language Test connection copy. The setup screens use these sentences as written. */

export const DEFAULT_LOCAL_ADDRESS = "http://localhost:11434";
export const DEFAULT_LOCAL_MODEL = "bonsai-2:9b";
export const LM_STUDIO_ADDRESS = "http://localhost:1234";
export const SMALLER_LOCAL_MODEL = "qwen3.5:4b";

/** Ollama is asked for this context window on each local turn. */
export const LOCAL_NUM_CTX = 8192;

/** A Test connection slower than this still counts as success and offers a smaller model. */
export const SLOW_PROBE_MS = 15_000;

export const CONNECTED_TITLE = "Connected.";
export const SLOW_TITLE = "Connected, but slow.";
export const OLLAMA_NOT_RUNNING_TITLE = "Ollama isn't running.";
export const OLLAMA_NOT_RUNNING_DETAIL = "Open the Ollama app, or run this in a terminal, then test again:";
export const OLLAMA_SERVE_COMMAND = "ollama serve";
export const MODEL_MISSING_TITLE = "Connected, but the model isn't downloaded.";
export const MODEL_MISSING_DETAIL = "Open Terminal and run this, then test again:";
export const NO_TOOLS_TITLE = "That model can't use tools.";
export const NO_TOOLS_DETAIL = "Pick bonsai-2:9b.";

export const ENDPOINT_UNREACHABLE_TITLE = "Couldn't reach that address.";
export const ENDPOINT_UNREACHABLE_DETAIL = "Check the URL and try again.";
export const ENDPOINT_MISSING_TITLE = "Connected, but that model isn't available there.";
export const ENDPOINT_MISSING_DETAIL = "Check the model name your service lists, then test again.";
export const ENDPOINT_NO_TOOLS_TITLE = "That model can't use tools.";
export const ENDPOINT_NO_TOOLS_DETAIL = "Pick a model that can call tools.";
export const ENDPOINT_KEY_TITLE = "That key was refused.";
export const ENDPOINT_KEY_DETAIL = "Check it and try again.";
export const ENDPOINT_ERROR_TITLE = "The endpoint returned an error.";
export const OLLAMA_ERROR_TITLE = "Ollama returned an error.";
export const EMPTY_REPLY_TITLE = "Connected, but the model sent an empty reply.";
export const EMPTY_REPLY_DETAIL = "Try another model, then test again.";

export const PLAIN_HTTP_TITLE = "This address isn't encrypted.";
export const PLAIN_HTTP_DETAIL =
  "Your key, questions and statements would cross the network as plain text. Use an https:// address if the service has one.";

export function cloudModelTitle(model: string): string {
  return `${model.trim()} runs on Ollama's servers, not on this computer.`;
}
export const CLOUD_MODEL_DETAIL =
  "Models ending in cloud send your questions and statements to ollama.com. To keep everything here, pick a model you downloaded.";

/** The service's own error message, or its HTTP status when it sent none. */
export function serviceErrorDetail(message: string | null, status: number): string {
  // Never show anything shaped like a key, even if a service echoes one back.
  const text = message?.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, "[key]").trim();
  if (!text) return `It answered with HTTP ${status}.`;
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

export const LOCAL_MODEL_HINT = "Recommended: bonsai-2:9b · any installed model id works";
export const SUGGESTED_OCR_MODEL = "glm-ocr";
export const OCR_MODEL_HINT = "Suggested: glm-ocr";
export const OCR_SECTION_TITLE = "Scanned statements";
export const OCR_SECTION_BODY =
  "Most bank PDFs have text inside and need no OCR. For scanned pages, pick a model that can read images.";
export const OCR_NONE_NOTE =
  "Without an OCR model, scanned pages may not be read. Text PDFs still work.";
export const OCR_PLACEHOLDER = "e.g. glm-ocr";
export const OCR_MISSING_DETAIL = "Run this, then test again:";
export const OCR_BLIND_DETAIL = "Pick a model that reads images.";
export const OCR_UNREACHABLE_TITLE = "Couldn't reach that address.";
export const OCR_UNREACHABLE_DETAIL = "Check that the app is open, then test again.";
export const LOCAL_STATEMENT_NOTE = "Statements are read on this computer. Nothing leaves it.";
export const ENDPOINT_IMPORT_TITLE = "For statement import";
export const ENDPOINT_IMPORT_NOTE =
  "Pick a model that can read PDF files and call tools. Otherwise import may fail; typing expenses still works.";
export const NOTHING_SAVED_TYPE = "Nothing was saved. You can still type expenses.";
export const FALLBACK_ROW_NOTE = "Read by fallback (chat model)";
export const IMPORT_STATEMENT = "Import a bank statement";
export const IMPORT_BUTTON = "Import";
export const LOCAL_READ_HINT = "A model on this computer can take a minute or two.";
export const PLACEHOLDER_IMPORT_FIRST = "Press Import to read the statement first";
export const PLACEHOLDER_STATEMENT_READY = "What should I add? e.g. everything, or groceries from 1 to 15 August";
export const PLACEHOLDER_STATEMENT_SEND = "What should I add from this statement?";
export const FINDING_ROWS = "Processing…";
export const ADD_EVERYTHING = "Add everything";
export const ADD_EVERYTHING_INSTRUCTION = "Add every transaction from this statement, money in and money out.";
export const FINISH_REVIEW_FIRST = "Confirm or cancel the statement above first.";
export const DEFAULT_STATEMENT_INSTRUCTION = "Add the transactions from this bank statement";

export function ocrReadyTitle(model: string): string {
  return `Ready: ${model.trim()} can read images.`;
}

export function ocrMissingTitle(model: string): string {
  return `${model.trim()} isn't downloaded.`;
}

export function ocrBlindTitle(model: string): string {
  return `${model.trim()} can't read images.`;
}

export function endpointPdfReadError(model: string): string {
  return `${model.trim()} couldn't read the PDF. Pick a model that reads PDF files, or use On this computer.`;
}

export function readingScannedPage(page: number, total: number, model: string): string {
  return `Reading scanned page ${page} of ${total} with ${model}…`;
}

export function scannedPageMix(filename: string, textPages: number, scannedPages: number): string {
  const text = textPages === 1 ? "1 page had text" : `${textPages} pages had text`;
  const scanned = scannedPages === 1 ? "1 is scanned" : `${scannedPages} are scanned`;
  return `${filename} · ${text}, ${scanned}`;
}

export function skippedScansNote(pages: readonly number[]): string {
  const label = pages.length === 1 ? `Page ${pages[0]} looks` : `Pages ${formatPageList(pages)} look`;
  return `${label} scanned and no OCR model is set, so they may be missing. Add one in Change assistant.`;
}

export function unreadablePageNote(page: number): string {
  return `Couldn't read page ${page}. It may be a photo that's too blurry. Try a sharper PDF, or set an OCR model in Change assistant.`;
}

export function missingPageBalanceNote(page: number): string {
  return `No balance check: page ${page} is missing.`;
}

/** "1–2", "3", or "2 and 4". */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const groups: string[] = [];
  let start = sorted[0] ?? 0;
  let previous = start;
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    groups.push(start === previous ? String(start) : `${start}\u2013${previous}`);
    start = current ?? 0;
    previous = start;
  }
  if (groups.length === 1) return groups[0] ?? "";
  if (groups.length === 2) return `${groups[0]} and ${groups[1]}`;
  return `${groups.slice(0, -1).join(", ")} and ${groups[groups.length - 1]}`;
}

export function modelAnswerName(model: string): string {
  if (/^qwen3\.5\b/i.test(model.trim())) return "Qwen3.5";
  return model.trim();
}

export function formatSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

export function answeredDetail(kind: "local" | "endpoint", model: string, seconds: string): string {
  if (kind === "endpoint") return `The model answered in ${seconds} s.`;
  return `${modelAnswerName(model)} answered in ${seconds} s.`;
}

export function slowDetail(kind: "local" | "endpoint", model: string, seconds: string): string {
  const answered = answeredDetail(kind, model, seconds);
  if (kind === "endpoint") return `${answered} You can continue with this one.`;
  return `${answered} A smaller model such as ${SMALLER_LOCAL_MODEL} is faster, but its answers are less reliable. You can continue with this one.`;
}

export function pullCommand(model: string): string {
  return `ollama pull ${model.trim()}`;
}

export function endpointHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}
