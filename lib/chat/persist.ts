import type { BankRef, Proposal, ReviewRow, RowFlag, StatementPage, StatementReview } from "./types";

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
  /** The question as the model got it, when the app filled in the year. */
  sentAs?: string;
};

export type StoredAssistant = {
  id: number;
  kind: "assistant";
  text: string;
  setupLink?: boolean;
  changeAssistant?: boolean;
  detail?: string;
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
  /** Groups this conversation's turns when Langfuse tracing is on. Reset by New chat. */
  sessionId?: string;
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
    ...(typeof value.note === "string" && value.note.trim() ? { note: clip(value.note).slice(0, 160) } : {}),
    ...(value.draft === true ? { draft: true } : {}),
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
  const statement = parseStatement(value.statement);
  return {
    sourceName: sourceName || null,
    currency: clip(value.currency).slice(0, 8),
    categories,
    banks,
    rows,
    ...(statement ? { statement } : {}),
  };
}

const PAGE_STATUS = ["read", "failed", "unread", "skipped"] as const;

function parseStatement(value: unknown): StatementReview | null {
  if (!isRecord(value) || !Array.isArray(value.pages) || value.pages.length > 500) return null;
  const pages: StatementPage[] = [];
  for (const page of value.pages) {
    if (!isRecord(page) || typeof page.page !== "number" || !Number.isInteger(page.page)) return null;
    if (typeof page.status !== "string" || !(PAGE_STATUS as readonly string[]).includes(page.status)) return null;
    pages.push({ page: page.page, status: page.status as StatementPage["status"] });
  }
  const numbers = (input: unknown) =>
    Array.isArray(input) && input.every((item) => typeof item === "number" && Number.isInteger(item) && item > 0)
      ? input.slice(0, 500)
      : null;
  const textPages = numbers(value.textPages);
  const scannedPages = numbers(value.scannedPages);
  const skippedPages = numbers(value.skippedPages);
  if (!textPages || !scannedPages || !skippedPages) return null;
  const pageCount = typeof value.pageCount === "number" && Number.isInteger(value.pageCount) ? value.pageCount : pages.length;
  const failedPage =
    typeof value.failedPage === "number" && Number.isInteger(value.failedPage) && value.failedPage > 0
      ? value.failedPage
      : null;
  const money = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  const account = typeof value.account === "string" ? clip(value.account).slice(0, 80) : "";
  const period = (input: unknown) => (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : null);
  return {
    account: account || null,
    periodStart: period(value.periodStart),
    periodEnd: period(value.periodEnd),
    pageCount,
    pages,
    textPages,
    scannedPages,
    skippedPages,
    failedPage,
    opening: money(value.opening),
    closing: money(value.closing),
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
    const sentAs = typeof value.sentAs === "string" ? clip(value.sentAs) : "";
    return {
      id,
      kind: "user",
      text,
      ...(statementName ? { statementName } : {}),
      ...(sentAs && sentAs !== text ? { sentAs } : {}),
    };
  }
  if (value.kind === "assistant" && typeof value.text === "string") {
    const text = clip(value.text);
    if (!text) return null;
    const detail = typeof value.detail === "string" ? clip(value.detail).slice(0, 300) : "";
    return {
      id,
      kind: "assistant",
      text,
      ...(value.setupLink === true ? { setupLink: true } : {}),
      ...(value.changeAssistant === true ? { changeAssistant: true } : {}),
      ...(detail ? { detail } : {}),
    };
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

function parseSessionId(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : "";
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
  sessionId?: string;
}): StoredChat {
  const items: StoredItem[] = [];
  for (const item of input.items) {
    if (item.kind === "status") continue;
    const parsed = parseItem(item);
    if (parsed) items.push(parsed);
  }
  return {
    v: 1,
    promptsUsed: input.promptsUsed || items.some((item) => item.kind === "user"),
    items: items.slice(-MAX_ITEMS),
    attachment: input.attachment ? parseAttachment(input.attachment) : null,
    ...withSessionId(input.sessionId),
  };
}

function withSessionId(value: unknown): { sessionId?: string } {
  const sessionId = parseSessionId(value);
  return sessionId ? { sessionId } : {};
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
  }
  return {
    v: 1,
    promptsUsed: value.promptsUsed === true || items.some((item) => item.kind === "user"),
    items: items.slice(-MAX_ITEMS),
    attachment: parseAttachment(value.attachment),
    ...withSessionId(value.sessionId),
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

/** A review or edit card has not been confirmed. New chat would discard it. */
export function needsNewChatConfirm(chat: StoredChat | null): boolean {
  if (!chat) return false;
  return chat.items.some(
    (item) => item.kind === "proposal" && (item.phase === "review" || item.phase === "edit"),
  );
}

/** Drop the oldest items until the transcript fits. An empty transcript still replaces a stale copy. */
export function fitStoredChat(chat: StoredChat): StoredChat {
  let next = chat;
  while (JSON.stringify(next).length > MAX_JSON && next.items.length > 0) {
    next = { ...next, items: next.items.slice(1) };
  }
  if (JSON.stringify(next).length > MAX_JSON) {
    next = { ...next, items: [], attachment: null };
  }
  return next;
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
    const json = JSON.stringify(fitStoredChat(chat));
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
