"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ReviewCard } from "@/components/tracker/review-card";
import {
  EMPTY_HEADING,
  EMPTY_SUBTITLE,
  PDF_DISCLOSURE,
  PLACEHOLDER_EMPTY,
  PLACEHOLDER_FOLLOWUP,
  READING_STATEMENT,
} from "@/lib/chat/copy";
import { PDF_DISCLOSURE_KEY, readConnection, type SavedConnection } from "@/lib/connection";
import { attachmentLabel, countPdfPages, isPdfBytes, MAX_PDF_BYTES, PDF_NOT_PDF, PDF_TOO_LARGE } from "@/lib/chat/pdf-meta";
import { suggestedPrompts } from "@/lib/chat/prompts";
import { rowsToSave } from "@/lib/chat/validate-rows";
import type { ChatTurn, Proposal, ReviewRow } from "@/lib/chat/types";

type Phase = "review" | "edit" | "saved" | "undone" | "cancelled";

type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; setupLink?: boolean }
  | { id: number; kind: "status"; text: string }
  | {
      id: number;
      kind: "proposal";
      phase: Phase;
      proposal: Proposal;
      savedIds?: number[];
      batchId?: string;
      error: string;
      busy: boolean;
    };

type Attachment = {
  file: File;
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
  const [ack, setAck] = useState(false);

  function nextId() {
    idRef.current += 1;
    return idRef.current;
  }

  useEffect(() => {
    setConnection(readConnection());
    try {
      setAck(window.localStorage.getItem(PDF_DISCLOSURE_KEY) === "1");
    } catch {
      setAck(false);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [items, pending]);

  const started = items.some((item) => item.kind === "user");
  const prompts = ready
    ? suggestedPrompts({
        bankName: connection?.banks[0]?.name ?? null,
        currency: connection?.currency ?? null,
      })
    : [];
  const showDisclosure = Boolean(attachment) && !ack;

  function patchProposal(id: number, patch: Partial<Extract<Item, { kind: "proposal" }>>) {
    setItems((current) =>
      current.map((item) => (item.id === id && item.kind === "proposal" ? { ...item, ...patch } : item)),
    );
  }

  async function onPickFile(file: File | undefined) {
    setFormError("");
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
    setAttachment({
      file,
      name: file.name || "statement.pdf",
      size: file.size,
      pages: countPdfPages(bytes),
    });
  }

  function acknowledge() {
    try {
      window.localStorage.setItem(PDF_DISCLOSURE_KEY, "1");
    } catch {
      // The notice stays dismissed for this visit even if storage is blocked.
    }
    setAck(true);
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

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending || sendLock.current) return;
    if (attachment && !ack) return;
    const saved = connection ?? readConnection();
    if (!saved?.openaiApiKey) {
      setItems((current) => [
        ...current,
        { id: nextId(), kind: "user", text },
        {
          id: nextId(),
          kind: "assistant",
          text: "Add an OpenAI key in setup before sending.",
          setupLink: true,
        },
      ]);
      setDraft("");
      return;
    }
    sendLock.current = true;
    const file = attachment;
    const prior = history();
    try {
      setDraft("");
      setAttachment(null);
      setFormError("");
      setPending(true);
      if (fileRef.current) fileRef.current.value = "";
      const statusId = nextId();
      setItems((current) => [
        ...current.filter((item) => item.kind !== "status"),
        { id: nextId(), kind: "user", text },
        { id: statusId, kind: "status", text: file ? READING_STATEMENT : "Working…" },
      ]);

      const data = file
        ? await postPdf(saved.openaiApiKey, text, file, prior)
        : await postChat(saved.openaiApiKey, [...prior, { role: "user", content: text }]);
      setItems((current) => {
        const without = current.filter((item) => item.id !== statusId);
        if (!data) {
          return [
            ...without,
            { id: nextId(), kind: "assistant", text: "Could not reach the tracker. Try again." },
          ];
        }
        if (data.ok !== true) {
          const error = typeof data.error === "string" ? data.error : "Could not do that.";
          return [...without, { id: nextId(), kind: "assistant", text: error }];
        }
        const proposal = data.proposal;
        if (isProposal(proposal) && proposal.rows.length > 0) {
          return [
            ...without,
            {
              id: nextId(),
              kind: "proposal",
              phase: "review",
              proposal,
              error: "",
              busy: false,
            },
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
    <main className="tracker-main">
      {started ? (
        <div className="tracker-thread" ref={threadRef} aria-live="polite">
          {items.map((item) => {
            if (item.kind === "user") {
              return (
                <p key={item.id} className="tracker-user">
                  {item.text}
                </p>
              );
            }
            if (item.kind === "assistant") {
              return (
                <div key={item.id} className="tracker-assistant">
                  <p>{item.text}</p>
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
                onPhase={(phase) => patchProposal(item.id, { phase })}
                onConfirm={() => void confirm(item.id)}
                onUndo={() => void undo(item.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="tracker-empty">
          <h1>{EMPTY_HEADING}</h1>
          <p>{EMPTY_SUBTITLE}</p>
          {prompts.length > 0 && (
            <div className="tracker-prompts">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="tracker-prompt"
                  onClick={() => {
                    setDraft(prompt);
                    inputRef.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <form className="tracker-form" onSubmit={(event) => void onSend(event)}>
        {showDisclosure && (
          <div className="tracker-notice">
            <p>{PDF_DISCLOSURE}</p>
            <button type="button" className="tracker-confirm" onClick={acknowledge}>
              Continue
            </button>
          </div>
        )}
        {attachment && (
          <div className="tracker-chip-row">
            <span className="tracker-chip">
              {attachmentLabel(attachment.name, attachment.pages, attachment.size)}
              <button
                type="button"
                className="tracker-chip-remove"
                aria-label="Remove file"
                onClick={() => {
                  setAttachment(null);
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
            placeholder={started ? PLACEHOLDER_FOLLOWUP : PLACEHOLDER_EMPTY}
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

async function postChat(apiKey: string, messages: ChatTurn[]): Promise<Record<string, unknown> | null> {
  return postJson("/api/chat", { apiKey, messages });
}

async function postPdf(
  apiKey: string,
  instruction: string,
  attachment: Attachment,
  messages: ChatTurn[],
): Promise<Record<string, unknown> | null> {
  try {
    const form = new FormData();
    form.set("apiKey", apiKey);
    form.set("instruction", instruction);
    form.set("messages", JSON.stringify(messages));
    form.set("file", attachment.file, attachment.name);
    const response = await fetch("/api/import/pdf", { method: "POST", body: form });
    return readBody(response);
  } catch {
    return null;
  }
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
