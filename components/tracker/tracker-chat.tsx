"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { createChatStore } from "@/components/tracker/chat-store";
import { ReplyText } from "@/components/tracker/reply-text";
import { ReviewCard } from "@/components/tracker/review-card";
import {
  endpointHostname,
  FINISH_REVIEW_FIRST,
  ADD_EVERYTHING,
  ADD_EVERYTHING_INSTRUCTION,
  FINDING_ROWS,
  IMPORT_BUTTON,
  IMPORT_STATEMENT,
  LOCAL_READ_HINT,
  LOCAL_STATEMENT_NOTE,
  PLACEHOLDER_IMPORT_FIRST,
  PLACEHOLDER_STATEMENT_READY,
  PLACEHOLDER_STATEMENT_SEND,
  readingScannedPage,
  scannedPageMix,
} from "@/lib/assistant/copy";
import {
  EMPTY_HEADING,
  EMPTY_SUBTITLE,
  PDF_DISCLOSURE,
  PLACEHOLDER_EMPTY,
  PLACEHOLDER_FOLLOWUP,
  PLACEHOLDER_TYPED,
  READING_STATEMENT,
  REATTACH_PDF,
  pdfGoesTo,
} from "@/lib/chat/copy";
import {
  assistantRequestFields,
  clearPdfDisclosureAck,
  readConnection,
  rememberActiveBanks,
  type SavedConnection,
} from "@/lib/connection";
import { parseHousehold } from "@/lib/data/parse";
import { countPdfPages, formatFileSize, isPdfBytes, MAX_PDF_BYTES, PDF_NOT_PDF, PDF_TOO_LARGE } from "@/lib/chat/pdf-meta";
import {
  buildStoredChat,
  CHAT_RESET_EVENT,
  readStoredChat,
  showNewChatButton,
  writeStoredChat,
  clearStoredChat,
  type StoredAssistant,
  type StoredProposal,
  type StoredUser,
} from "@/lib/chat/persist";
import { recentModelTurns, suggestedPrompts } from "@/lib/chat/prompts";
import { rowsToSave } from "@/lib/chat/validate-rows";
import type { ChatTurn, Proposal, ReviewRow } from "@/lib/chat/types";

type Item =
  | StoredUser
  | StoredAssistant
  | { id: number; kind: "status"; text: string }
  | (StoredProposal & { busy: boolean });

type ReadPage = { page: number; kind: string; text: string };

type Attachment = {
  file: File | null;
  name: string;
  size: number;
  pages: number | null;
  /** Local assistant only: pages already read on this computer by Import. */
  read?: ReadPage[] | null;
};

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.2 12.4 14.6 6a3.1 3.1 0 0 1 4.4 4.4l-8.1 8.1a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ChatState = {
  items: Item[];
  draft: string;
  attachment: Attachment | null;
  pending: boolean;
  formError: string;
  ack: boolean;
  promptsUsed: boolean;
  hydrated: boolean;
  reading: Reading | null;
  /** Groups this conversation's turns when Langfuse tracing is on. Reset by New chat. */
  sessionId: string;
};

// The chat lives outside the component so a read or an answer keeps running while another page is
// open, and is on screen when the user comes back. New chat (or a reload) starts over.
const chat = createChatStore<ChatState>({
  items: [],
  draft: "",
  attachment: null,
  pending: false,
  formError: "",
  ack: false,
  promptsUsed: false,
  hydrated: false,
  reading: null,
  sessionId: "",
});
const idRef = { current: 1 };
const sendLock = { current: false };
const actionLock = { current: new Set<number>() };
const abortRef: { current: AbortController | null } = { current: null };
/** Bumped by New chat. Work started in an earlier chat drops its result. */
const chatEpoch = { current: 0 };

// Saved on every change, including while the user is on another page.
let lastSaved: Pick<ChatState, "items" | "promptsUsed" | "attachment" | "sessionId"> | null = null;
chat.subscribe(() => {
  const state = chat.get();
  if (!state.hydrated) return;
  if (
    lastSaved &&
    lastSaved.items === state.items &&
    lastSaved.promptsUsed === state.promptsUsed &&
    lastSaved.attachment === state.attachment &&
    lastSaved.sessionId === state.sessionId
  ) {
    return;
  }
  lastSaved = {
    items: state.items,
    promptsUsed: state.promptsUsed,
    attachment: state.attachment,
    sessionId: state.sessionId,
  };
  const stored = buildStoredChat({
    promptsUsed: state.promptsUsed,
    items: state.items,
    attachment: state.attachment,
    sessionId: state.sessionId,
  });
  if (!showNewChatButton(stored)) clearStoredChat();
  else writeStoredChat(stored);
});

/**
 * New chat and Set up completely new. Listens at module level so a reset from another page
 * (the chat is not mounted during /data/reset) still empties the chat kept in memory.
 */
function resetChat(): void {
  chatEpoch.current += 1;
  abortRef.current?.abort();
  abortRef.current = null;
  idRef.current = 1;
  sendLock.current = false;
  actionLock.current.clear();
  for (const [key, value] of Object.entries({
    reading: null,
    items: [],
    draft: "",
    attachment: null,
    formError: "",
    pending: false,
    promptsUsed: false,
    ack: false,
    sessionId: "",
  } satisfies Partial<ChatState>)) {
    chat.set(key as keyof ChatState, value as never);
  }
}

if (typeof window !== "undefined") window.addEventListener(CHAT_RESET_EVENT, resetChat);

/** This conversation's trace session, created on its first request. */
function chatSession(): string {
  let id = chat.get().sessionId;
  if (!id) {
    id = newSessionId();
    chat.set("sessionId", id);
  }
  return id;
}

export function TrackerChat() {
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = chat.useField("items");
  const [draft, setDraft] = chat.useField("draft");
  const [attachment, setAttachment] = chat.useField("attachment");
  const [pending, setPending] = chat.useField("pending");
  const [formError, setFormError] = chat.useField("formError");
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [ready, setReady] = useState(false);
  const [banksReady, setBanksReady] = useState(false);
  const [ack, setAck] = chat.useField("ack");
  const [promptsUsed, setPromptsUsed] = chat.useField("promptsUsed");
  const [hydrated, setHydrated] = chat.useField("hydrated");
  const [reading, setReading] = chat.useField("reading");
  const [now, setNow] = useState(0);
  const readingSince = reading?.startedAt ?? null;

  function nextId() {
    idRef.current += 1;
    return idRef.current;
  }

  useEffect(() => {
    // Once per page load. Coming back from another page keeps what is already here.
    if (chat.get().hydrated) return;
    clearPdfDisclosureAck();
    setAck(false);
    const stored = readStoredChat();
    if (stored) {
      setPromptsUsed(stored.promptsUsed);
      chat.set("sessionId", stored.sessionId ?? "");
      setItems(
        stored.items.map((item) => (item.kind === "proposal" ? { ...item, busy: false } : item)),
      );
      if (stored.attachment) setAttachment({ ...stored.attachment, file: null });
      const maxId = stored.items.reduce((max, item) => Math.max(max, item.id), 1);
      idRef.current = maxId;
    }
    setHydrated(true);
  }, [setAck, setAttachment, setHydrated, setItems, setPromptsUsed]);

  useEffect(() => {
    // The chat itself is cleared by resetChat below; this only empties the file picker on screen.
    function clearPicker() {
      if (fileRef.current) fileRef.current.value = "";
    }
    window.addEventListener(CHAT_RESET_EVENT, clearPicker);
    return () => window.removeEventListener(CHAT_RESET_EVENT, clearPicker);
  }, []);

  useEffect(() => {
    const existing = readConnection();
    setConnection(existing);
    setReady(true);
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/household");
        const household = parseHousehold(await response.json());
        if (ignore || !household) return;
        if (rememberActiveBanks(household)) setConnection(readConnection());
      } catch {
        // Prompts keep the banks already stored in this browser.
      } finally {
        if (!ignore) setBanksReady(true);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (readingSince === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [readingSince]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [items, pending]);

  const hasThread = items.some(
    (item) => item.kind === "user" || item.kind === "assistant" || item.kind === "proposal",
  );
  const started = promptsUsed || items.some((item) => item.kind === "user");
  const localAssistant = connection?.assistant.type === "local";
  const endpointAssistant = connection?.assistant.type === "endpoint";
  const prompts =
    ready && banksReady
      ? suggestedPrompts({
          bankName: connection?.banks[0]?.name ?? null,
          currency: connection?.currency ?? null,
          statement: true,
          statementPrompt: localAssistant ? IMPORT_STATEMENT : undefined,
          statementLast: localAssistant,
        })
      : [];
  const showDisclosure = !localAssistant && Boolean(attachment?.file) && !ack;
  const disclosure = endpointAssistant
    ? pdfGoesTo(endpointHostname(connection?.assistant.type === "endpoint" ? connection.assistant.baseUrl : ""))
    : PDF_DISCLOSURE;
  const reviewingStatement = items.some(
    (item) => item.kind === "proposal" && item.phase === "review" && Boolean(item.proposal.statement),
  );
  // A local assistant reads the PDF first (Import), then the note picks the rows (Send).
  const needsRead = localAssistant && Boolean(attachment?.file) && !attachment?.read && !reviewingStatement;
  const statementReady =
    Boolean(attachment?.file) && !reading && !showDisclosure && !reviewingStatement && !needsRead;

  function patchProposal(id: number, patch: Partial<Extract<Item, { kind: "proposal" }>>) {
    setItems((current) =>
      current.map((item) => (item.id === id && item.kind === "proposal" ? { ...item, ...patch } : item)),
    );
  }

  async function onPickFile(file: File | undefined) {
    setFormError("");
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) {
      setFormError(PDF_TOO_LARGE);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(bytes)) {
      setFormError(PDF_NOT_PDF);
      return;
    }
    setAck(localAssistant);
    setAttachment({
      file,
      name: file.name || "statement.pdf",
      size: file.size,
      pages: countPdfPages(bytes),
    });
  }

  function onDropPdf(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void onPickFile(event.dataTransfer.files?.[0]);
  }

  function acknowledge() {
    setAck(true);
  }

  function cancelDisclosure() {
    setAttachment(null);
    setAck(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function history(): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const item of items) {
      if (item.kind === "user") turns.push({ role: "user", content: item.sentAs ?? item.text });
      else if (item.kind === "assistant") turns.push({ role: "assistant", content: item.text });
      else if (item.kind === "proposal" && item.phase === "saved") {
        turns.push({ role: "assistant", content: "The user saved the proposed transactions." });
      } else if (item.kind === "proposal" && item.phase === "cancelled") {
        turns.push({ role: "assistant", content: "The user cancelled. Nothing was saved." });
      } else if (item.kind === "proposal") {
        turns.push({
          role: "assistant",
          content: "Transactions were proposed and are waiting for confirmation.",
        });
      }
    }
    return turns;
  }

  function assistantFrom(data: Record<string, unknown>, fallback: string): Item {
    const error = typeof data.error === "string" ? data.error : fallback;
    const detail = typeof data.detail === "string" ? data.detail : "";
    return {
      id: nextId(),
      kind: "assistant",
      text: error,
      ...(data.changeAssistant === true ? { changeAssistant: true } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  async function runImport(instruction: string, file: Attachment) {
    const saved = connection ?? readConnection();
    if (!saved?.assistant) {
      setPromptsUsed(true);
      setItems((current) => [
        ...current,
        { id: nextId(), kind: "user", text: instruction },
        {
          id: nextId(),
          kind: "assistant",
          text: "Add an assistant in setup before sending.",
          setupLink: true,
        },
      ]);
      return;
    }
    if (!file.file) {
      setFormError(REATTACH_PDF);
      return;
    }
    sendLock.current = true;
    const epoch = chatEpoch.current;
    const prior = history();
    const controller = new AbortController();
    abortRef.current = controller;
    const filename = file.name || "statement.pdf";
    try {
      setDraft("");
      setFormError("");
      setPending(true);
      setPromptsUsed(true);
      setReading({
        filename,
        step: "propose",
        phase: "text",
        page: 0,
        total: 0,
        model: "",
        textPages: 0,
        scannedPages: 0,
        startedAt: Date.now(),
      });
      setItems((current) => [
        ...current.filter((item) => item.kind !== "status"),
        { id: nextId(), kind: "user", text: instruction, statementName: filename },
      ]);
      const turns = recentModelTurns<ChatTurn>([...prior, { role: "user", content: instruction }]);
      const local = saved.assistant.type === "local";
      const data = await postPdf({ ...assistantRequestFields(saved.assistant), sessionId: chatSession() }, file, {
        instruction,
        messages: turns.slice(0, -1),
        step: local && file.read ? "propose" : undefined,
        pages: local && file.read ? file.read : undefined,
        signal: controller.signal,
        onProgress: (event) => {
          setReading((current) =>
            current
              ? {
                  ...current,
                  phase: "scan",
                  page: event.page,
                  total: event.total,
                  model: event.model,
                  textPages: event.textPages,
                  scannedPages: event.scannedPages,
                }
              : current,
          );
        },
      });
      if (epoch !== chatEpoch.current) return;
      if (controller.signal.aborted || data?.cancelled === true) {
        setItems((current) => [...current, { id: nextId(), kind: "assistant", text: "Cancelled. Nothing was saved." }]);
        return;
      }
      const proposal = data?.ok === true ? data.proposal : null;
      const accepted = isProposal(proposal) && proposal.rows.length > 0;
      if (accepted && !local) {
        setAttachment(null);
        setAck(false);
        if (fileRef.current) fileRef.current.value = "";
      }
      setItems((current) => {
        if (!data) {
          return [...current, { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." }];
        }
        if (data.ok !== true) return [...current, assistantFrom(data, "Could not read that statement.")];
        if (accepted && isProposal(proposal)) {
          return [
            ...current,
            { id: nextId(), kind: "proposal", phase: "review", proposal, error: "", busy: false },
          ];
        }
        return [...current, { id: nextId(), kind: "assistant", text: "No transactions were read from that statement." }];
      });
    } catch (error) {
      if (epoch !== chatEpoch.current) return;
      const text =
        error instanceof DOMException && error.name === "AbortError"
          ? "Cancelled. Nothing was saved."
          : "Could not reach the tracker. Try again.";
      setItems((current) => [...current, { id: nextId(), kind: "assistant", text }]);
    } finally {
      if (epoch === chatEpoch.current) {
        abortRef.current = null;
        setReading(null);
        sendLock.current = false;
        setPending(false);
      }
    }
  }

  /** Import: read the PDF on this computer. No model picks rows yet; that waits for the user's note. */
  async function readStatement() {
    const saved = connection ?? readConnection();
    const file = attachment;
    if (!saved?.assistant || saved.assistant.type !== "local" || !file?.file || reading || sendLock.current) return;
    sendLock.current = true;
    const epoch = chatEpoch.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const filename = file.name || "statement.pdf";
    try {
      setFormError("");
      setPending(true);
      setReading({
        filename,
        step: "read",
        phase: "text",
        page: 0,
        total: 0,
        model: "",
        textPages: 0,
        scannedPages: 0,
        startedAt: Date.now(),
      });
      const data = await postPdf({ ...assistantRequestFields(saved.assistant), sessionId: chatSession() }, file, {
        step: "read",
        signal: controller.signal,
        onProgress: (event) => {
          setReading((current) => (current ? { ...current, phase: "scan", ...event } : current));
        },
      });
      if (epoch !== chatEpoch.current || controller.signal.aborted || data?.cancelled === true) return;
      const read = data?.ok === true ? readPagesOf(data.read) : null;
      if (read) {
        setAttachment((current) => (current && current.file === file.file ? { ...current, read } : current));
        inputRef.current?.focus();
        return;
      }
      setPromptsUsed(true);
      setItems((current) => [
        ...current,
        data
          ? assistantFrom(data, "Could not read that statement.")
          : { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." },
      ]);
    } catch (error) {
      if (epoch === chatEpoch.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setItems((current) => [...current, { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." }]);
      }
    } finally {
      if (epoch === chatEpoch.current) {
        abortRef.current = null;
        setReading(null);
        sendLock.current = false;
        setPending(false);
      }
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (pending || sendLock.current) return;
    if (attachment && !attachment.file) {
      setFormError(REATTACH_PDF);
      return;
    }
    if (attachment && !ack && !localAssistant) return;
    if (attachment?.file && !reviewingStatement) {
      if (needsRead || !text) return;
      await runImport(text, attachment);
      return;
    }
    if (!text) return;
    const saved = connection ?? readConnection();
    if (!saved?.assistant) {
      setPromptsUsed(true);
      setItems((current) => [
        ...current,
        { id: nextId(), kind: "user", text },
        {
          id: nextId(),
          kind: "assistant",
          text: "Add an assistant in setup before sending.",
          setupLink: true,
        },
      ]);
      setDraft("");
      return;
    }
    sendLock.current = true;
    const epoch = chatEpoch.current;
    const prior = history();
    try {
      setDraft("");
      setFormError("");
      setPending(true);
      setPromptsUsed(true);
      const statusId = nextId();
      const userId = nextId();
      setItems((current) => [
        ...current.filter((item) => item.kind !== "status"),
        { id: userId, kind: "user", text },
        { id: statusId, kind: "status", text: "Working…" },
      ]);
      const turns = recentModelTurns<ChatTurn>([...prior, { role: "user", content: text }]);
      const data = await postChat({ ...assistantRequestFields(saved.assistant), sessionId: chatSession() }, turns);
      if (epoch !== chatEpoch.current) return;
      const sentAs = typeof data?.sentAs === "string" && data.sentAs !== text ? data.sentAs : null;
      setItems((current) => {
        const without = current
          .filter((item) => item.id !== statusId)
          .map((item) => (sentAs && item.id === userId && item.kind === "user" ? { ...item, sentAs } : item));
        if (!data) {
          return [...without, { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." }];
        }
        if (data.ok !== true) return [...without, assistantFrom(data, "Could not do that.")];
        const proposal = data.proposal;
        if (isProposal(proposal) && proposal.rows.length > 0) {
          return [
            ...without,
            { id: nextId(), kind: "proposal", phase: "review", proposal, error: "", busy: false },
          ];
        }
        const reply = typeof data.reply === "string" && data.reply ? data.reply : "I couldn’t read a transaction from that. Try rephrasing it.";
        return [...without, { id: nextId(), kind: "assistant", text: reply }];
      });
    } finally {
      if (epoch === chatEpoch.current) {
        sendLock.current = false;
        setPending(false);
      }
    }
  }

  async function confirm(id: number) {
    const item = items.find((entry) => entry.id === id && entry.kind === "proposal");
    if (!item || item.kind !== "proposal" || item.busy || actionLock.current.has(id)) return;
    actionLock.current.add(id);
    patchProposal(id, { busy: true, error: "" });
    const epoch = chatEpoch.current;
    const data = await postJson("/api/transactions/confirm", {
      rows: rowsToSave(item.proposal.rows).map((row) => ({
        date: row.date,
        description: row.description,
        category: row.category,
        bank: row.bank,
        amount: row.amount,
      })),
    });
    actionLock.current.delete(id);
    if (epoch !== chatEpoch.current) return;
    if (!data || data.ok !== true || !Array.isArray(data.ids) || typeof data.batchId !== "string") {
      patchProposal(id, {
        busy: false,
        error: typeof data?.error === "string" ? data.error : "Could not save those transactions.",
      });
      return;
    }
    patchProposal(id, {
      busy: false,
      phase: "saved",
      savedIds: data.ids.filter((value): value is number => typeof value === "number"),
      batchId: data.batchId,
      error: "",
    });
    setAttachment(null);
    setAck(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function undo(id: number) {
    const item = items.find((entry) => entry.id === id && entry.kind === "proposal");
    if (!item || item.kind !== "proposal" || !item.savedIds || !item.batchId || actionLock.current.has(id)) return;
    actionLock.current.add(id);
    patchProposal(id, { busy: true, error: "" });
    const data = await postJson("/api/transactions/undo", {
      ids: item.savedIds,
      batchId: item.batchId,
    });
    actionLock.current.delete(id);
    if (!data || data.ok !== true) {
      patchProposal(id, {
        busy: false,
        error: typeof data?.error === "string" ? data.error : "Could not undo those transactions.",
      });
      return;
    }
    patchProposal(id, { busy: false, phase: "undone", error: "" });
  }

  return (
    <main className="tracker-main" onDragOver={(event) => event.preventDefault()} onDrop={onDropPdf}>
      {hydrated && hasThread ? (
        <div className="tracker-thread" ref={threadRef} aria-live="polite">
          {items.map((item) => {
            if (item.kind === "user") {
              return (
                <p key={item.id} className="tracker-user">
                  {item.text}
                  {item.statementName ? <span className="tracker-statement">{item.statementName}</span> : null}
                </p>
              );
            }
            if (item.kind === "assistant") {
              return (
                <div key={item.id} className={item.changeAssistant ? "tracker-assistant is-import-error" : "tracker-assistant"}>
                  <ReplyText text={item.text} />
                  {item.changeAssistant ? (
                    <a className="tracker-setup-link" href="/data/assistant">
                      Change assistant
                    </a>
                  ) : null}
                  {item.detail ? <p className="tracker-import-detail">{item.detail}</p> : null}
                  {item.setupLink && (
                    <a className="tracker-setup-link" href="/setup">
                      Open setup
                    </a>
                  )}
                </div>
              );
            }
            if (item.kind === "status") {
              return (
                <p key={item.id} className="tracker-status">
                  {item.text}
                </p>
              );
            }
            return (
              <ReviewCard
                key={item.id}
                proposal={item.proposal}
                phase={item.phase}
                busy={item.busy}
                error={item.error}
                onRows={(rows: ReviewRow[]) =>
                  patchProposal(item.id, { proposal: { ...item.proposal, rows } })
                }
                onPhase={(phase) => {
                  patchProposal(item.id, { phase });
                  if (phase === "cancelled" && !attachment?.read) {
                    setAttachment(null);
                    setAck(false);
                    if (fileRef.current) fileRef.current.value = "";
                  }
                }}
                onConfirm={() => void confirm(item.id)}
                onUndo={() => void undo(item.id)}
              />
            );
          })}
        </div>
      ) : hydrated ? (
        <div className="tracker-empty">
          <h1>{EMPTY_HEADING}</h1>
          <p>{localAssistant ? "Type it in plain language, or attach a bank statement PDF." : EMPTY_SUBTITLE}</p>
          {prompts.length > 0 && (
            <div className="tracker-prompts">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="tracker-prompt"
                  onClick={() => {
                    if (prompt === IMPORT_STATEMENT) {
                      fileRef.current?.click();
                      return;
                    }
                    setDraft(prompt);
                    inputRef.current?.focus();
                  }}
                >
                  {prompt === IMPORT_STATEMENT ? <span className="prompt-clip" aria-hidden="true"><PaperclipIcon /></span> : null}
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="tracker-empty" />
      )}

      <form className="tracker-form" onSubmit={(event) => void onSend(event)}>
        {showDisclosure && (
          <div className="tracker-notice">
            <p>{disclosure}</p>
            <div className="tracker-notice-actions">
              <button type="button" className="tracker-confirm" onClick={acknowledge}>
                Continue
              </button>
              <button type="button" className="tracker-quiet" onClick={cancelDisclosure}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {localAssistant && !attachment && !reading && (
          <p className="tracker-privacy" data-testid="local-statement-note">
            <span aria-hidden="true">🔒 </span>
            {LOCAL_STATEMENT_NOTE}
          </p>
        )}
        {endpointAssistant && (attachment || reading) ? (
          <p className="tracker-privacy" data-testid="endpoint-transfer-note">
            <span aria-hidden="true">🔒 </span>
            {disclosure}
          </p>
        ) : null}
        {reading ? (
          <div className="tracker-tray is-reading" aria-live="polite" data-testid="import-tray">
            <FileBadge />
            <div className="tracker-tray-body">
              <p className="tracker-tray-title">
                {reading.step === "propose"
                  ? FINDING_ROWS
                  : reading.phase === "scan"
                    ? readingScannedPage(reading.page, reading.total, reading.model)
                    : READING_STATEMENT}
              </p>
              <p className="tracker-tray-meta">
                {reading.step === "read" && reading.phase === "scan"
                  ? scannedPageMix(reading.filename, reading.textPages, reading.scannedPages)
                  : reading.filename}
                {localAssistant && (reading.step === "propose" || reading.phase === "scan") ? ` · ${LOCAL_READ_HINT}` : ""}
              </p>
              <div
                className={
                  reading.step === "read" && reading.phase === "scan" && reading.total > 0
                    ? "import-bar"
                    : "import-bar is-indeterminate"
                }
                aria-hidden="true"
              >
                <span
                  style={
                    reading.step === "read" && reading.phase === "scan" && reading.total > 0
                      ? { width: `${Math.min(95, 10 + (reading.page / reading.total) * 85)}%` }
                      : undefined
                  }
                />
              </div>
            </div>
            <div className="tracker-tray-side">
              <span className="tracker-tray-time">{formatElapsed(now - reading.startedAt)}</span>
              <button type="button" className="tracker-tray-cancel" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          </div>
        ) : attachment ? (
          <div className="tracker-tray" data-testid="import-tray">
            <FileBadge />
            <div className="tracker-tray-body">
              <p className="tracker-tray-title">{attachment.name}</p>
              <p className={attachment.file ? "tracker-tray-meta" : "tracker-tray-meta is-warn"}>
                {attachmentMeta(attachment, {
                  reviewing: reviewingStatement,
                  local: localAssistant,
                })}
              </p>
            </div>
            {needsRead ? (
              <button
                type="button"
                className="tracker-tray-import"
                data-testid="import-read"
                disabled={pending}
                onClick={() => void readStatement()}
              >
                {IMPORT_BUTTON}
              </button>
            ) : localAssistant && statementReady ? (
              <button
                type="button"
                className="tracker-tray-quick"
                disabled={pending}
                onClick={() => void runImport(ADD_EVERYTHING_INSTRUCTION, attachment)}
              >
                {ADD_EVERYTHING}
              </button>
            ) : null}
            <button
              type="button"
              className="tracker-chip-remove"
              aria-label="Remove file"
              onClick={() => {
                setAttachment(null);
                setAck(false);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="tracker-compose">
          <button
            type="button"
            className="tracker-clip"
            aria-label="Attach a bank statement PDF"
            disabled={Boolean(reading)}
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </button>
          <input
            ref={inputRef}
            className={draft ? "has-value" : undefined}
            value={draft}
            aria-label="Expense or instruction"
            placeholder={
              needsRead
                ? PLACEHOLDER_IMPORT_FIRST
                : statementReady
                  ? localAssistant
                    ? PLACEHOLDER_STATEMENT_READY
                    : PLACEHOLDER_STATEMENT_SEND
                  : started
                    ? PLACEHOLDER_FOLLOWUP
                    : localAssistant
                      ? PLACEHOLDER_TYPED
                      : PLACEHOLDER_EMPTY
            }
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button
            className="tracker-send"
            type="submit"
            disabled={pending || showDisclosure || needsRead || !draft.trim()}
          >
            Send
          </button>
        </div>
        {formError && <p className="tracker-form-error tracker-form-error-pad">{formError}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => void onPickFile(event.target.files?.[0])}
        />
      </form>
    </main>
  );
}

function isProposal(value: unknown): value is Proposal {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Proposal;
  return Array.isArray(record.rows) && typeof record.currency === "string" && Array.isArray(record.categories);
}

async function postJson(path: string, body: object): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return readBody(response);
  } catch {
    return null;
  }
}

/** Only used to group a conversation's turns when Langfuse tracing is on. */
function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function postChat(
  fields: { apiKey?: string; assistant?: object; sessionId?: string },
  messages: ChatTurn[],
): Promise<Record<string, unknown> | null> {
  return postJson("/api/chat", { ...fields, messages });
}

type ScanEvent = {
  page: number;
  total: number;
  model: string;
  textPages: number;
  scannedPages: number;
};

type Reading = {
  filename: string;
  /** read: Import is reading the PDF. propose: the model is picking rows for the user's note. */
  step: "read" | "propose";
  phase: "text" | "scan";
  page: number;
  total: number;
  model: string;
  textPages: number;
  scannedPages: number;
  startedAt: number;
};

function FileBadge() {
  return (
    <span className="tracker-file-badge" aria-hidden="true">
      PDF
    </span>
  );
}

function attachmentMeta(attachment: Attachment, state: { reviewing: boolean; local: boolean }): string {
  if (!attachment.file) return "Reattach to send";
  if (state.reviewing) return FINISH_REVIEW_FIRST;
  const parts: string[] = [];
  if (attachment.read) {
    const count = attachment.read.filter((page) => page.text.trim()).length;
    parts.push(`${count} ${count === 1 ? "page" : "pages"} read on this computer`);
    parts.push("say what to add, then Send");
    return parts.join(" · ");
  }
  if (attachment.pages && attachment.pages > 0) {
    parts.push(`${attachment.pages} ${attachment.pages === 1 ? "page" : "pages"}`);
  }
  const size = formatFileSize(attachment.size);
  if (size) parts.push(size);
  parts.push(state.local ? "read on this computer" : "say what to add, then Send");
  return parts.join(" · ");
}

function readPagesOf(value: unknown): ReadPage[] | null {
  if (typeof value !== "object" || value === null) return null;
  const pages = (value as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return null;
  const read: ReadPage[] = [];
  for (const item of pages) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as { page?: unknown; kind?: unknown; text?: unknown };
    if (typeof record.page !== "number" || typeof record.kind !== "string" || typeof record.text !== "string") return null;
    read.push({ page: record.page, kind: record.kind, text: record.text });
  }
  return read.length ? read : null;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function postPdf(
  fields: { apiKey?: string; assistant?: object; sessionId?: string },
  attachment: Attachment,
  options: {
    instruction?: string;
    messages?: ChatTurn[];
    step?: "read" | "propose";
    pages?: ReadPage[];
    signal?: AbortSignal;
    onProgress?: (event: ScanEvent) => void;
  },
): Promise<Record<string, unknown> | null> {
  try {
    const form = new FormData();
    if (fields.apiKey) form.set("apiKey", fields.apiKey);
    if (fields.assistant) form.set("assistant", JSON.stringify(fields.assistant));
    if (fields.sessionId) form.set("sessionId", fields.sessionId);
    if (options.instruction) form.set("instruction", options.instruction);
    form.set("messages", JSON.stringify(options.messages ?? []));
    if (options.step) form.set("step", options.step);
    if (options.step === "propose" && options.pages) {
      // The text was read on this computer and goes back to this computer only.
      form.set("pages", JSON.stringify(options.pages));
      form.set("filename", attachment.name);
    } else {
      if (!attachment.file) return null;
      form.set("file", attachment.file, attachment.name);
    }
    const response = await fetch("/api/import/pdf", { method: "POST", body: form, signal: options.signal });
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("ndjson")) return readNdjson(response, options.onProgress);
    return readBody(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

async function readNdjson(
  response: Response,
  onProgress?: (event: ScanEvent) => void,
): Promise<Record<string, unknown> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === "progress" && event.phase === "scan") {
        onProgress?.({
          page: Number(event.page) || 0,
          total: Number(event.total) || 0,
          model: typeof event.model === "string" ? event.model : "",
          textPages: Number(event.textPages) || 0,
          scannedPages: Number(event.scannedPages) || 0,
        });
      }
      if (event.type === "result") result = event;
    }
  }
  return result;
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.json();
    if (typeof data === "object" && data !== null) return data as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}
