"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ReviewCard } from "@/components/tracker/review-card";
import {
  DEFAULT_STATEMENT_INSTRUCTION,
  endpointHostname,
  IMPORT_STATEMENT,
  IMPORT_THIS_STATEMENT,
  LOCAL_STATEMENT_NOTE,
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
import { attachmentLabel, countPdfPages, isPdfBytes, MAX_PDF_BYTES, PDF_NOT_PDF, PDF_TOO_LARGE } from "@/lib/chat/pdf-meta";
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

type Attachment = {
  file: File | null;
  name: string;
  size: number;
  pages: number | null;
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

export function TrackerChat() {
  const idRef = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendLock = useRef(false);
  const actionLock = useRef(new Set<number>());
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [ready, setReady] = useState(false);
  const [banksReady, setBanksReady] = useState(false);
  const [ack, setAck] = useState(false);
  const [promptsUsed, setPromptsUsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function nextId() {
    idRef.current += 1;
    return idRef.current;
  }

  useEffect(() => {
    const stored = readStoredChat();
    if (stored) {
      setPromptsUsed(stored.promptsUsed);
      setItems(
        stored.items.map((item) => (item.kind === "proposal" ? { ...item, busy: false } : item)),
      );
      if (stored.attachment) setAttachment({ ...stored.attachment, file: null });
      const maxId = stored.items.reduce((max, item) => Math.max(max, item.id), 1);
      idRef.current = maxId;
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const stored = buildStoredChat({ promptsUsed, items, attachment });
    if (!showNewChatButton(stored)) clearStoredChat();
    else writeStoredChat(stored);
  }, [hydrated, promptsUsed, items, attachment]);

  useEffect(() => {
    function reset() {
      setItems([]);
      setDraft("");
      setAttachment(null);
      setFormError("");
      setPending(false);
      setPromptsUsed(false);
      setAck(false);
      idRef.current = 1;
      sendLock.current = false;
      actionLock.current.clear();
      if (fileRef.current) fileRef.current.value = "";
    }
    window.addEventListener(CHAT_RESET_EVENT, reset);
    return () => window.removeEventListener(CHAT_RESET_EVENT, reset);
  }, []);

  useEffect(() => {
    const existing = readConnection();
    setConnection(existing);
    clearPdfDisclosureAck();
    setAck(false);
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
  const showImport = Boolean(attachment?.file) && !reading && (localAssistant || (endpointAssistant && ack));

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
      if (item.kind === "user") turns.push({ role: "user", content: item.text });
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

  async function runImport(instruction: string, file: Attachment, quiet: boolean) {
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
    const prior = history();
    const controller = new AbortController();
    abortRef.current = controller;
    const local = saved.assistant.type === "local";
    try {
      setDraft("");
      setFormError("");
      setPending(true);
      setPromptsUsed(true);
      const statusId = nextId();
      if (local) {
        setReading({
          filename: file.name || "statement.pdf",
          phase: "text",
          page: 0,
          total: 0,
          model: "",
          textPages: 0,
          scannedPages: 0,
        });
      } else {
        setItems((current) => [
          ...current.filter((item) => item.kind !== "status"),
          ...(quiet
            ? []
            : [{ id: nextId(), kind: "user" as const, text: instruction, statementName: file.name || "statement.pdf" }]),
          { id: statusId, kind: "status" as const, text: READING_STATEMENT },
        ]);
      }
      const turns = recentModelTurns<ChatTurn>([...prior, { role: "user", content: instruction }]);
      const data = await postPdf(assistantRequestFields(saved.assistant), instruction, file, turns.slice(0, -1), {
        signal: controller.signal,
        onProgress: (event) => {
          setReading({
            filename: file.name || "statement.pdf",
            phase: "scan",
            page: event.page,
            total: event.total,
            model: event.model,
            textPages: event.textPages,
            scannedPages: event.scannedPages,
          });
        },
      });
      if (controller.signal.aborted || data?.cancelled === true) {
        setItems((current) => [
          ...current.filter((item) => item.id !== statusId),
          { id: nextId(), kind: "assistant", text: "Cancelled. Nothing was saved." },
        ]);
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
        const lead = current.filter((item) => item.id !== statusId && item.kind !== "status");
        if (!data) {
          return [...lead, { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." }];
        }
        if (data.ok !== true) return [...lead, assistantFrom(data, "Could not read that statement.")];
        if (accepted && isProposal(proposal)) {
          return [
            ...lead,
            { id: nextId(), kind: "proposal", phase: "review", proposal, error: "", busy: false },
          ];
        }
        return [...lead, { id: nextId(), kind: "assistant", text: "No transactions were read from that statement." }];
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setItems((current) => [
          ...current.filter((item) => item.kind !== "status"),
          { id: nextId(), kind: "assistant", text: "Cancelled. Nothing was saved." },
        ]);
        return;
      }
      setItems((current) => [
        ...current.filter((item) => item.kind !== "status"),
        { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." },
      ]);
    } finally {
      abortRef.current = null;
      setReading(null);
      sendLock.current = false;
      setPending(false);
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending || sendLock.current) return;
    if (attachment && !attachment.file) {
      setFormError(REATTACH_PDF);
      return;
    }
    if (attachment && !ack && !localAssistant) return;
    if (attachment?.file && !reviewingStatement) {
      await runImport(text, attachment, false);
      return;
    }
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
    const prior = history();
    try {
      setDraft("");
      setFormError("");
      setPending(true);
      setPromptsUsed(true);
      const statusId = nextId();
      setItems((current) => [
        ...current.filter((item) => item.kind !== "status"),
        { id: nextId(), kind: "user", text },
        { id: statusId, kind: "status", text: "Working…" },
      ]);
      const turns = recentModelTurns<ChatTurn>([...prior, { role: "user", content: text }]);
      const data = await postChat(assistantRequestFields(saved.assistant), turns);
      setItems((current) => {
        const without = current.filter((item) => item.id !== statusId);
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
      sendLock.current = false;
      setPending(false);
    }
  }

  async function confirm(id: number) {
    const item = items.find((entry) => entry.id === id && entry.kind === "proposal");
    if (!item || item.kind !== "proposal" || item.busy || actionLock.current.has(id)) return;
    actionLock.current.add(id);
    patchProposal(id, { busy: true, error: "" });
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
      {reading ? (
        <div className="tracker-reading">
          {attachment ? <ImportLaunch attachment={attachment} disabled /> : null}
          <section className="tracker-card import-progress" aria-live="polite">
            <h2>
              {reading.phase === "scan"
                ? readingScannedPage(reading.page, reading.total, reading.model)
                : "Reading statement…"}
            </h2>
            <p>
              {reading.phase === "scan"
                ? scannedPageMix(reading.filename, reading.textPages, reading.scannedPages)
                : reading.filename}
            </p>
            <div className="import-bar" aria-hidden="true">
              <span
                style={{
                  width:
                    reading.phase === "scan" && reading.total > 0
                      ? `${Math.min(95, 20 + (reading.page / reading.total) * 75)}%`
                      : "35%",
                }}
              />
            </div>
            <button
              type="button"
              className="import-cancel"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          </section>
        </div>
      ) : (
        <>
      {showImport && attachment ? (
        <div className="tracker-reading is-ready">
          <ImportLaunch
            attachment={attachment}
            disabled={reviewingStatement}
            onImport={
              reviewingStatement
                ? undefined
                : () => void runImport(draft.trim() || DEFAULT_STATEMENT_INSTRUCTION, attachment, !draft.trim())
            }
          />
        </div>
      ) : null}
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
                  <p>
                    {item.text}{" "}
                    {item.changeAssistant ? (
                      <a className="tracker-setup-link" href="/data/assistant">
                        Change assistant
                      </a>
                    ) : null}
                  </p>
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
                  if (phase === "cancelled") {
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
        </>
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
        {localAssistant && (
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
        {attachment && !showImport ? (
          <div className="tracker-chip-row">
            <span className="tracker-chip">
              {attachmentLabel(attachment.name, attachment.pages, attachment.size)}
              {!attachment.file ? <span className="tracker-chip-note">Reattach to send</span> : null}
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
            </span>
          </div>
        )}
        <div className="tracker-compose">
          <button
            type="button"
            className="tracker-clip"
            aria-label="Attach a bank statement PDF"
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </button>
          <input
            ref={inputRef}
            className={draft ? "has-value" : undefined}
            value={draft}
            aria-label="Expense or instruction"
            placeholder={started ? PLACEHOLDER_FOLLOWUP : localAssistant ? PLACEHOLDER_TYPED : PLACEHOLDER_EMPTY}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button className="tracker-send" type="submit" disabled={pending || !draft.trim() || showDisclosure}>
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

async function postChat(
  fields: { apiKey?: string; assistant?: object },
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
  phase: "text" | "scan";
  page: number;
  total: number;
  model: string;
  textPages: number;
  scannedPages: number;
};

function ImportLaunch({
  attachment,
  disabled = false,
  onImport,
}: {
  attachment: Attachment;
  disabled?: boolean;
  onImport?: () => void;
}) {
  const pages = attachment.pages && attachment.pages > 0 ? `${attachment.pages} ${attachment.pages === 1 ? "page" : "pages"}` : "";
  return (
    <div className="import-launch">
      <p>
        <span aria-hidden="true">📄 </span>
        {attachment.name}
        {pages ? ` · ${pages}` : ""}
      </p>
      <button type="button" disabled={disabled || !onImport} onClick={onImport}>
        {IMPORT_THIS_STATEMENT}
      </button>
    </div>
  );
}

async function postPdf(
  fields: { apiKey?: string; assistant?: object },
  instruction: string,
  attachment: Attachment,
  messages: ChatTurn[],
  options?: { signal?: AbortSignal; onProgress?: (event: ScanEvent) => void },
): Promise<Record<string, unknown> | null> {
  try {
    const form = new FormData();
    if (fields.apiKey) form.set("apiKey", fields.apiKey);
    if (fields.assistant) form.set("assistant", JSON.stringify(fields.assistant));
    form.set("instruction", instruction);
    form.set("messages", JSON.stringify(messages));
    if (!attachment.file) return null;
    form.set("file", attachment.file, attachment.name);
    const response = await fetch("/api/import/pdf", { method: "POST", body: form, signal: options?.signal });
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("ndjson")) return readNdjson(response, options?.onProgress);
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
