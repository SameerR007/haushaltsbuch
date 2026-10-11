import type { BankRef, Proposal, ReviewRow, RowFlag } from "./types";

/** Browser transcript for the Chat tab. The OpenAI key is never written here. */
export const CHAT_STORAGE_KEY = "haushaltsbuch.chat";

export const CHAT_CHANGED_EVENT = "haushaltsbuch-chat";
export const CHAT_RESET_EVENT = "haushaltsbuch-chat-reset";

const PHASES = ["review", "edit", "saved", "undone", "cancelled"] as const;
const FLAGS = [
  "invalid_date",
  "invalid_amount",
  "unknown_category",
  "unknown_bank",
  "duplicate",
  "uncertain",
] as const;

export type ChatPhase = (typeof PHASES)[number];

export type StoredUser = {
  id: number;
  kind: "user";
  text: string;
  statementName?: string;
};

export type StoredAssistant = {
  id: number;
  kind: "assistant";
  text: string;
  setupLink?: boolean;
};

export type StoredProposal = {
  id: number;
  kind: "proposal";
  phase: ChatPhase;
  proposal: Proposal;
  savedIds?: number[];
  batchId?: string;
  error: string;
};

export type StoredItem = StoredUser | StoredAssistant | StoredProposal;

/** Name and size only. The PDF bytes stay on the File the user just picked. */
export type StoredAttachment = {
  name: string;
  size: number;
  pages: number | null;
};

export type StoredChat = {
  v: 1;
  promptsUsed: boolean;
  items: StoredItem[];
  attachment: StoredAttachment | null;
};

type LiveItem =
  | StoredUser
  | StoredAssistant
  | { id: number; kind: "status"; text: string }
  | (StoredProposal & { busy?: boolean });

const MAX_ITEMS = 60;
const MAX_TEXT = 8_000;
const MAX_JSON = 400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_TEXT);
}

function finiteId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000) return null;
  return value;
}

function parseFlags(value: unknown): RowFlag[] {
  if (!Array.isArray(value)) return [];
  const flags: RowFlag[] = [];
  for (const flag of value) {
    if (typeof flag === "string" && (FLAGS as readonly string[]).includes(flag)) {
      flags.push(flag as RowFlag);
    }
  }
  return flags;
}

function parseRow(value: unknown): ReviewRow | null {
  if (!isRecord(value)) return null;
  const description = typeof value.description === "string" ? clip(value.description) : "";
  const category = typeof value.category === "string" ? clip(value.category) : "";
  const bank = typeof value.bank === "string" ? clip(value.bank) : "";
  const dateInput = typeof value.dateInput === "string" ? clip(value.dateInput) : "";
  const amountInput = typeof value.amountInput === "string" ? clip(value.amountInput) : "";
  const date = typeof value.date === "string" ? clip(value.date) : null;
  const amount = typeof value.amount === "number" && Number.isFinite(value.amount) ? value.amount : null;
  const bankInitials = typeof value.bankInitials === "string" ? clip(value.bankInitials).slice(0, 4) : null;
  const duplicateOf = finiteId(value.duplicateOf);
  const duplicateKey = typeof value.duplicateKey === "string" ? clip(value.duplicateKey) : null;
  return {
    date,
    dateInput,
    description,
    category,
    bank,
    bankInitials: bankInitials || null,
    amount,
    amountInput,
    flags: parseFlags(value.flags),
    duplicateOf,
    duplicateKey,
    ...(value.includeDuplicate === true ? { includeDuplicate: true } : {}),
  };
}

function parseBank(value: unknown): BankRef | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.initials !== "string") return null;
  const name = clip(value.name);
  const initials = clip(value.initials).slice(0, 4);
  if (!name || !initials) return null;
  return { name, initials };
}

function parseProposal(value: unknown): Proposal | null {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 400) {
    return null;
  }
  if (typeof value.currency !== "string" || !Array.isArray(value.categories) || !Array.isArray(value.banks)) {
    return null;
  }
  const rows: ReviewRow[] = [];
  for (const row of value.rows) {
    const parsed = parseRow(row);
    if (parsed) rows.push(parsed);
  }
  if (rows.length === 0) return null;
  const banks: BankRef[] = [];
  for (const bank of value.banks) {
    const parsed = parseBank(bank);
    if (parsed) banks.push(parsed);
  }
  const categories = value.categories.filter((category): category is string => typeof category === "string").map(clip);
  const sourceName = typeof value.sourceName === "string" ? clip(value.sourceName).slice(0, 120) : null;
  return {
    sourceName: sourceName || null,
    currency: clip(value.currency).slice(0, 8),
    categories,
    banks,
    rows,
  };
}

function parseItem(value: unknown): StoredItem | null {
  if (!isRecord(value)) return null;
  const id = finiteId(value.id);
  if (!id) return null;
  if (value.kind === "user" && typeof value.text === "string") {
    const text = clip(value.text);
    if (!text) return null;
    const statementName = typeof value.statementName === "string" ? clip(value.statementName).slice(0, 120) : "";
    return statementName ? { id, kind: "user", text, statementName } : { id, kind: "user", text };
  }
  if (value.kind === "assistant" && typeof value.text === "string") {
    const text = clip(value.text);
    if (!text) return null;
    return value.setupLink === true
      ? { id, kind: "assistant", text, setupLink: true }
      : { id, kind: "assistant", text };
  }
  if (value.kind === "proposal" && (PHASES as readonly string[]).includes(String(value.phase))) {
    const proposal = parseProposal(value.proposal);
    if (!proposal) return null;
    const savedIds = Array.isArray(value.savedIds)
      ? value.savedIds.filter((entry): entry is number => finiteId(entry) !== null)
      : undefined;
    const batchId = typeof value.batchId === "string" ? clip(value.batchId).slice(0, 80) : "";
    return {
      id,
      kind: "proposal",
      phase: value.phase as ChatPhase,
      proposal,
      ...(savedIds && savedIds.length > 0 ? { savedIds } : {}),
      ...(batchId ? { batchId } : {}),
      error: typeof value.error === "string" ? clip(value.error).slice(0, 300) : "",
    };
  }
  return null;
}

function parseAttachment(value: unknown): StoredAttachment | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const name = clip(value.name).slice(0, 120);
  if (!name) return null;
  const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? value.size : 0;
  const pages =
    typeof value.pages === "number" && Number.isInteger(value.pages) && value.pages > 0 && value.pages < 10_000
      ? value.pages
      : null;
  return { name, size, pages };
}

/** Drop status rows, in-flight flags, file bytes, and any field that is not part of the transcript. */
export function buildStoredChat(input: {
  promptsUsed: boolean;
  items: readonly LiveItem[];
  attachment: (StoredAttachment & { file?: unknown }) | null;
}): StoredChat {
  const items: StoredItem[] = [];
  for (const item of input.items) {
    if (item.kind === "status") continue;
    const parsed = parseItem(item);
    if (parsed) items.push(parsed);
    if (items.length >= MAX_ITEMS) break;
  }
  return {
    v: 1,
    promptsUsed: input.promptsUsed || items.some((item) => item.kind === "user"),
    items,
    attachment: input.attachment ? parseAttachment(input.attachment) : null,
  };
}

export function parseStoredChat(raw: string | null): StoredChat | null {
  if (!raw || raw.length > MAX_JSON) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.items)) return null;
  const items: StoredItem[] = [];
  for (const item of value.items) {
    const parsed = parseItem(item);
    if (parsed) items.push(parsed);
    if (items.length >= MAX_ITEMS) break;
  }
  return {
    v: 1,
    promptsUsed: value.promptsUsed === true || items.some((item) => item.kind === "user"),
    items,
    attachment: parseAttachment(value.attachment),
  };
}

/**
 * New chat is useful once the empty prompt screen has been left.
 * A headline with only the suggested prompts does not get the button.
 */
export function showNewChatButton(chat: StoredChat | null): boolean {
  if (!chat) return false;
  if (chat.attachment) return true;
  return chat.items.some(
    (item) => item.kind === "user" || item.kind === "assistant" || item.kind === "proposal",
  );
}

function notifyChanged(): void {
  const target = globalThis.window;
  if (!target?.dispatchEvent) return;
  target.dispatchEvent(new Event(CHAT_CHANGED_EVENT));
}

export function readStoredChat(): StoredChat | null {
  try {
    return parseStoredChat(globalThis.localStorage?.getItem(CHAT_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeStoredChat(chat: StoredChat): void {
  try {
    const json = JSON.stringify(chat);
    if (json.length > MAX_JSON) return;
    globalThis.localStorage?.setItem(CHAT_STORAGE_KEY, json);
    notifyChanged();
  } catch {
    // The conversation stays on screen for this visit when storage is blocked.
  }
}

export function clearStoredChat(): void {
  try {
    globalThis.localStorage?.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // The in-memory chat is still cleared by the caller.
  }
  notifyChanged();
}

export function requestNewChat(): void {
  clearStoredChat();
  const target = globalThis.window;
  if (!target?.dispatchEvent) return;
  target.dispatchEvent(new Event(CHAT_RESET_EVENT));
}
