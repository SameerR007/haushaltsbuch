/**
 * localStorage key for a saved household connection.
 *
 * Read on the landing page (see `app/layout.tsx`) before first paint:
 * - missing or empty → first visit: “Get started” only
 * - any non-empty string → returning: “Open tracker” and “Review the data”
 *
 * Setup writes version 3 JSON (see `SavedConnection`) when the chat is confirmed.
 * A version 2 object (an OpenAI key and no assistant type) is read as on OpenAI.
 * A key stays in this browser. The database path is not stored.
 * A non-JSON marker such as `"1"` still counts as returning on the landing page.
 */
import { endpointHostname } from "./assistant/copy";
import {
  chatBaseUrl,
  endpointAddressError,
  localAddressError,
  modelNameOk,
  type AssistantKind,
  type AssistantTarget,
} from "./assistant/target";
import { requestNewChat } from "./chat/persist";
import { clearSummaryView } from "./data/summary-state";
import { looksLikeOpenAiKey } from "./setup/guards";

export type { AssistantKind, AssistantTarget };

export const CONNECTION_STORAGE_KEY = "haushaltsbuch.connection";

/**
 * Leftover key from when the PDF notice was remembered.
 * Nothing writes it. Chat load, saving setup, and a full reset remove it.
 */
export const PDF_DISCLOSURE_KEY = "haushaltsbuch.pdfDisclosureAck";

/** True when `value` is a non-empty connection marker. */
export function hasSavedConnection(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

export type SavedBank = {
  name: string;
  initials: string;
};

/**
 * Where the assistant runs. Saved with the household, not in the database.
 * `local` keeps an app address and a model. `endpoint` keeps a base URL, a
 * model, and a key. `openai` keeps the OpenAI key. The key never leaves this
 * browser except on a request the user just made.
 */
export type AssistantSettings =
  | { type: "openai"; apiKey: string }
  | { type: "local"; address: string; model: string; ocrModel?: string | null }
  | { type: "endpoint"; baseUrl: string; model: string; apiKey: string };

/**
 * Browser-only assistant settings and household preferences.
 * Version 3 has no project URL, anon key, or database path.
 * `banks` lists active banks only. It may be empty after every bank is removed.
 */
export type SavedConnection = {
  v: 3;
  assistant: AssistantSettings;
  currency: string;
  banks: SavedBank[];
};

export function assistantKind(connection: SavedConnection): AssistantKind {
  return connection.assistant.type;
}

/** Open tracker is ready when the assistant, currency, and at least one bank are saved. */
export function isTrackerReady(connection: SavedConnection | null): boolean {
  if (!connection) return false;
  if (!/^[A-Z]{3}$/.test(connection.currency)) return false;
  if (connection.banks.length < 1) return false;
  return assistantComplete(connection.assistant);
}

export function assistantComplete(assistant: AssistantSettings): boolean {
  if (assistant.type === "openai") return looksLikeOpenAiKey(assistant.apiKey);
  if (!modelNameOk(assistant.model)) return false;
  if (assistant.type === "local") return chatBaseUrl(assistant.address) !== null;
  return chatBaseUrl(assistant.baseUrl) !== null && assistant.apiKey.trim().length > 0;
}

/** “on this computer (bonsai-2:9b) · OCR: glm-ocr”. The OCR part is omitted when none is set. */
export function localAssistantLabel(model: string, ocrModel?: string | null): string {
  const base = `on this computer (${model})`;
  const ocr = ocrModel?.trim() ?? "";
  return ocr ? `${base} · OCR: ${ocr}` : base;
}

/** The assistant as separate lines. Both local models run here, so "on this computer" is said once. */
export function assistantLines(assistant: AssistantSettings): string[] {
  if (assistant.type !== "local") return [assistantSummary(assistant)];
  const ocr = assistant.ocrModel?.trim() ?? "";
  const lines = ["on this computer", `Model: ${assistant.model}`];
  return ocr ? [...lines, `OCR: ${ocr}`] : lines;
}

/** Review-the-data and the landing line. The endpoint key is never included. */
export function assistantSummary(assistant: AssistantSettings): string {
  if (assistant.type === "local") return localAssistantLabel(assistant.model, assistant.ocrModel);
  if (assistant.type === "openai") return "on OpenAI";
  const host = endpointHostname(assistant.baseUrl);
  return host ? `OpenAI-compatible endpoint (${host})` : "OpenAI-compatible endpoint";
}

/** Landing line under “Assistant:”. */
export function assistantHomeLabel(assistant: AssistantSettings): string {
  return assistantSummary(assistant);
}

export function assistantUsesKey(assistant: AssistantSettings): boolean {
  return assistant.type === "openai" || assistant.type === "endpoint";
}

/** Chat/PDF body. Local and endpoint send `assistant`. OpenAI keeps `apiKey`. */
export function assistantRequestFields(assistant: AssistantSettings): {
  apiKey?: string;
  assistant?: AssistantTarget;
} {
  if (assistant.type === "openai") return { apiKey: assistant.apiKey };
  if (assistant.type === "local") {
    const ocr = assistant.ocrModel?.trim() ?? "";
    return {
      assistant: {
        type: "local",
        baseUrl: chatBaseUrl(assistant.address) ?? assistant.address,
        model: assistant.model,
        ...(ocr ? { ocrModel: ocr } : {}),
      },
    };
  }
  return {
    assistant: {
      type: "endpoint",
      baseUrl: chatBaseUrl(assistant.baseUrl) ?? assistant.baseUrl,
      model: assistant.model,
      apiKey: assistant.apiKey,
    },
  };
}

export function parseConnection(raw: string | null | undefined): SavedConnection | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) return null;
  const banks = parseBanks(row.banks);
  if (!banks) return null;

  // A connection saved before this feature has an OpenAI key and no assistant type.
  if (row.v === 2) {
    const assistant = parseOpenAiKey(row.openaiApiKey);
    if (!assistant) return null;
    return { v: 3, assistant, currency: row.currency, banks };
  }
  if (row.v !== 3) return null;
  const assistant = parseAssistant(row.assistant);
  if (!assistant) return null;
  return { v: 3, assistant, currency: row.currency, banks };
}

function optionalOcr(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const model = value.trim();
  if (!model) return null;
  return modelNameOk(model) ? model : "invalid";
}

function parseOpenAiKey(value: unknown): AssistantSettings | null {
  if (typeof value !== "string" || !value.startsWith("sk-") || value.length < 10 || value.length > 300) {
    return null;
  }
  return { type: "openai", apiKey: value };
}

function parseAssistant(value: unknown): AssistantSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type === "openai") return parseOpenAiKey(row.apiKey);
  if (row.type === "local") {
    if (typeof row.address !== "string" || typeof row.model !== "string") return null;
    const address = row.address.trim();
    const model = row.model.trim();
    if (localAddressError(address) || !modelNameOk(model)) return null;
    const ocr = optionalOcr(row.ocrModel);
    if (ocr === "invalid") return null;
    return ocr ? { type: "local", address, model, ocrModel: ocr } : { type: "local", address, model };
  }
  if (row.type === "endpoint") {
    if (typeof row.baseUrl !== "string" || typeof row.model !== "string" || typeof row.apiKey !== "string") {
      return null;
    }
    const baseUrl = row.baseUrl.trim();
    const model = row.model.trim();
    const apiKey = row.apiKey.trim();
    if (endpointAddressError(baseUrl) || !modelNameOk(model) || !apiKey || apiKey.length > 500) return null;
    return { type: "endpoint", baseUrl, model, apiKey };
  }
  return null;
}

function parseBanks(value: unknown): SavedBank[] | null {
  if (!Array.isArray(value)) return null;
  const banks: SavedBank[] = [];
  for (const bank of value) {
    if (typeof bank !== "object" || bank === null) return null;
    const entry = bank as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.initials !== "string") return null;
    const name = entry.name.trim();
    const initials = entry.initials.trim().toUpperCase();
    if (!name || initials.length < 1 || initials.length > 4) return null;
    banks.push({ name, initials });
  }
  return banks;
}

export function readConnection(): SavedConnection | null {
  const storage = globalThis.localStorage;
  if (!storage) return null;
  try {
    return parseConnection(storage.getItem(CONNECTION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeConnection(
  value: SavedConnection,
  options?: { clearPdfDisclosure?: boolean },
): void {
  const stored: SavedConnection = {
    v: 3,
    assistant: value.assistant,
    currency: value.currency,
    banks: value.banks,
  };
  globalThis.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(stored));
  if (options?.clearPdfDisclosure !== false) clearPdfDisclosureAck();
  // The landing CSS reads this attribute. A client navigation back to /
  // does not re-run the head script, so set it for the current tab too.
  globalThis.document.documentElement.dataset.visit = "returning";
}

/** Keep the browser key, and store only banks the server still treats as active. */
export function rememberActiveBanks(input: {
  currency: string | null;
  banks: readonly { name: string; initials: string; active: boolean }[];
}): boolean {
  const existing = readConnection();
  if (!existing || !input.currency || !/^[A-Z]{3}$/.test(input.currency)) return false;
  const banks: SavedBank[] = input.banks
    .filter((bank) => bank.active)
    .map((bank) => ({ name: bank.name, initials: bank.initials }));
  const same =
    existing.currency === input.currency &&
    existing.banks.length === banks.length &&
    existing.banks.every(
      (bank, index) => bank.name === banks[index]?.name && bank.initials === banks[index]?.initials,
    );
  if (same) return false;
  writeConnection({ ...existing, currency: input.currency, banks }, { clearPdfDisclosure: false });
  return true;
}

/** Remove a stored PDF acknowledgement left by an older version of the tracker. */
export function clearPdfDisclosureAck(): void {
  try {
    globalThis.localStorage?.removeItem(PDF_DISCLOSURE_KEY);
  } catch {
    // Storage can be blocked. The notice still shows for each new PDF.
  }
}

/** Drop the browser connection and chat only after the server has confirmed a full reset. */
export function clearConnection(): void {
  const storage = globalThis.localStorage;
  if (storage) storage.removeItem(CONNECTION_STORAGE_KEY);
  clearPdfDisclosureAck();
  // Also empties a chat still held in memory from earlier in this visit.
  requestNewChat();
  clearSummaryView();
  const root = globalThis.document?.documentElement;
  if (root?.dataset) delete root.dataset.visit;
}
