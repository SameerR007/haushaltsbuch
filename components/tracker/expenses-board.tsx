"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { amountKeepingSign, formatMoney, formatRowDate } from "@/lib/chat/money";
import { XLSX_FILENAME } from "@/lib/data/copy";
import { parseTransactionList } from "@/lib/data/parse";
import type { BankView, TransactionView } from "@/lib/data/types";
import { currencySummaryLabel } from "@/lib/setup/chat-logic";

type Field = "date" | "notes" | "category" | "bank" | "amount";

type Draft = {
  date: string;
  notes: string;
  category: string;
  bank: string;
  amountInput: string;
};

type Status = "idle" | "editing" | "saved" | "error";

function draftFrom(row: TransactionView): Draft {
  return {
    date: row.date,
    notes: row.notes ?? "",
    category: row.category,
    bank: row.bank,
    amountInput: String(row.amount),
  };
}

function fieldChanged(field: Field, saved: TransactionView, draft: Draft): boolean {
  if (field === "date") return draft.date !== saved.date;
  if (field === "notes") return draft.notes !== (saved.notes ?? "");
  if (field === "category") return draft.category !== saved.category;
  if (field === "bank") return draft.bank !== saved.bank;
  return amountKeepingSign(draft.amountInput, saved.amount) !== String(saved.amount);
}

function bankLabel(banks: readonly BankView[], name: string): string {
  const bank = banks.find((item) => item.name === name);
  return bank ? `${bank.name} (${bank.initials})` : name;
}

function bankOptions(banks: readonly BankView[], current: string): BankView[] {
  const active = banks.filter((bank) => bank.active);
  if (active.some((bank) => bank.name === current)) return active;
  const extra = banks.find((bank) => bank.name === current);
  return extra ? [...active, extra] : active;
}

function isTransaction(value: unknown): value is TransactionView {
  if (typeof value !== "object" || value === null) return false;
  const row = value as TransactionView;
  return (
    typeof row.id === "number" &&
    typeof row.date === "string" &&
    typeof row.category === "string" &&
    typeof row.bank === "string" &&
    typeof row.amount === "number" &&
    (row.notes === null || typeof row.notes === "string")
  );
}

function mergeField(current: TransactionView, field: Field, next: TransactionView): TransactionView {
  if (field === "date") return { ...current, date: next.date };
  if (field === "notes") return { ...current, notes: next.notes };
  if (field === "category") return { ...current, category: next.category };
  if (field === "bank") return { ...current, bank: next.bank };
  return { ...current, amount: next.amount };
}

function payload(field: Field, draft: Draft, previousAmount: number): Record<string, string> {
  if (field === "date") return { date: draft.date };
  if (field === "notes") return { notes: draft.notes };
  if (field === "category") return { category: draft.category };
  if (field === "bank") return { bank: draft.bank };
  return { amount: amountKeepingSign(draft.amountInput, previousAmount) };
}

async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function ExpensesBoard() {
  const [currency, setCurrency] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [banks, setBanks] = useState<BankView[]>([]);
  const [rows, setRows] = useState<TransactionView[]>([]);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/transactions");
        const list = parseTransactionList(await response.json());
        if (!response.ok || !list) throw new Error("unread");
        if (ignore) return;
        setCurrency(list.currency);
        setCategories(list.categories);
        setBanks(list.banks);
        setRows(list.transactions);
      } catch {
        if (!ignore) setError("Could not load expenses.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const subtitle = currency
    ? `Newest first · amounts in ${currencySummaryLabel(currency)}`
    : "Newest first";

  async function onDownload() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadFile("/api/export/xlsx", XLSX_FILENAME);
    } catch {
      setDownloadError("Could not download the Excel file.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="expenses">
      <div className="expenses-head">
        <div>
          <h1>Expenses</h1>
          <p>{subtitle}</p>
        </div>
        <div className="expenses-download-wrap">
          <button type="button" className="expenses-download" disabled={downloading} onClick={() => void onDownload()}>
            {downloading ? "Downloading…" : "⬇ Download as Excel"}
          </button>
          {downloadError ? (
            <p className="expenses-download-error" role="alert">
              {downloadError}
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="expenses-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="expenses-foot">Loading expenses…</p> : null}
      {!loading && !error ? (
        <>
          <div className="expenses-sheet">
            <table className="expenses-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Bank</th>
                  <th className="is-num">Amount</th>
                  <th>
                    <span className="sr-only">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No expenses yet.</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <ExpenseRow
                      key={row.id}
                      transaction={row}
                      banks={banks}
                      categories={categories}
                      currency={currency ?? "EUR"}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="expenses-foot">Click a cell to edit. Changes save on their own.</p>
        </>
      ) : null}
    </main>
  );
}

function ExpenseRow({
  transaction,
  banks,
  categories,
  currency,
}: {
  transaction: TransactionView;
  banks: BankView[];
  categories: string[];
  currency: string;
}) {
  const [saved, setSaved] = useState(transaction);
  const savedRef = useRef(saved);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(transaction));
  const draftRef = useRef(draft);
  const [status, setStatus] = useState<Status>("idle");
  const [editing, setEditing] = useState<Field | null>(null);
  const [failed, setFailed] = useState<Field | null>(null);
  const failedRef = useRef<Field | null>(null);
  const savingFields = useRef(new Set<Field>());

  function updateDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }

  function commitSaved(next: TransactionView) {
    savedRef.current = next;
    setSaved(next);
  }

  function begin(field: Field) {
    if (field === "amount") {
      const magnitude = Math.abs(savedRef.current.amount);
      const next = {
        ...draftRef.current,
        amountInput: magnitude === 0 ? "0" : String(magnitude),
      };
      updateDraft(next);
    }
    setEditing(field);
    setStatus("editing");
  }

  function rememberFailure(field: Field) {
    failedRef.current = field;
    setFailed(field);
    setStatus("error");
    setEditing(field);
  }

  async function persist(field: Field, snapshot: Draft) {
    if (savingFields.current.has(field)) return;
    if (!fieldChanged(field, savedRef.current, snapshot)) {
      if (failedRef.current === field) {
        failedRef.current = null;
        setFailed(null);
      }
      setEditing((current) => (current === field ? null : current));
      setStatus(failedRef.current ? "error" : "idle");
      return;
    }
    savingFields.current.add(field);
    setStatus("editing");
    setEditing(field);
    try {
      const response = await fetch(`/api/transactions/${savedRef.current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(field, snapshot, savedRef.current.amount)),
      });
      const data: unknown = await response.json();
      const record =
        typeof data === "object" && data !== null
          ? (data as { ok?: unknown; transaction?: unknown })
          : null;
      const next = record?.transaction;
      if (!response.ok || record?.ok !== true || !isTransaction(next)) {
        rememberFailure(field);
        return;
      }
      const merged = mergeField(savedRef.current, field, next);
      commitSaved(merged);
      if (draftRef.current === snapshot) {
        const fresh = draftFrom(merged);
        draftRef.current = fresh;
        setDraft(fresh);
      }
      if (failedRef.current === field) {
        failedRef.current = null;
        setFailed(null);
      }
      setEditing((current) => (current === field ? null : current));
      setStatus(failedRef.current ? "error" : "saved");
    } catch {
      rememberFailure(field);
    } finally {
      savingFields.current.delete(field);
    }
  }

  function undo() {
    const fresh = draftFrom(savedRef.current);
    draftRef.current = fresh;
    failedRef.current = null;
    setDraft(fresh);
    setStatus("idle");
    setEditing(null);
    setFailed(null);
  }

  const rowClass = status === "saved" ? "is-saved" : undefined;

  return (
    <tr className={rowClass}>
      <Cell
        field="date"
        label="Date"
        editing={editing}
        failed={failed}
        onBegin={() => begin("date")}
        display={formatRowDate(saved.date)}
      >
        <input
          aria-label="Date"
          type="date"
          autoFocus
          value={draft.date}
          className={failed === "date" ? "is-invalid" : undefined}
          onChange={(event) => updateDraft({ ...draftRef.current, date: event.target.value })}
          onBlur={() => void persist("date", draftRef.current)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </Cell>
      <Cell
        field="notes"
        label="Description"
        editing={editing}
        failed={failed}
        onBegin={() => begin("notes")}
        display={saved.notes?.trim() ? saved.notes : "—"}
      >
        <input
          aria-label="Description"
          type="text"
          autoFocus
          value={draft.notes}
          className={failed === "notes" ? "is-invalid" : undefined}
          onChange={(event) => updateDraft({ ...draftRef.current, notes: event.target.value })}
          onBlur={() => void persist("notes", draftRef.current)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </Cell>
      <td>
        {editing === "category" || failed === "category" ? (
          <select
            aria-label="Category"
            autoFocus
            value={draft.category}
            className={failed === "category" ? "is-invalid" : undefined}
            onChange={(event) => {
              const next = { ...draftRef.current, category: event.target.value };
              updateDraft(next);
              void persist("category", next);
            }}
            onBlur={() => {
              if (failed !== "category") void persist("category", draftRef.current);
            }}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
            {!categories.includes(draft.category) && draft.category ? (
              <option value={draft.category}>{draft.category}</option>
            ) : null}
          </select>
        ) : (
          <button type="button" className="cell-button" onClick={() => begin("category")}>
            <span className="tracker-cat">{saved.category}</span>
          </button>
        )}
      </td>
      <td>
        {editing === "bank" || failed === "bank" ? (
          <select
            aria-label="Bank"
            autoFocus
            value={draft.bank}
            className={failed === "bank" ? "is-invalid" : undefined}
            onChange={(event) => {
              const next = { ...draftRef.current, bank: event.target.value };
              updateDraft(next);
              void persist("bank", next);
            }}
            onBlur={() => {
              if (failed !== "bank") void persist("bank", draftRef.current);
            }}
          >
            {bankOptions(banks, saved.bank).map((bank) => (
              <option key={bank.name} value={bank.name}>
                {bank.name} ({bank.initials})
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="cell-button" onClick={() => begin("bank")}>
            {bankLabel(banks, saved.bank)}
          </button>
        )}
      </td>
      <td className="is-num">
        {editing === "amount" || failed === "amount" ? (
          <div className="amount-edit">
            <input
              aria-label="Amount"
              inputMode="decimal"
              autoFocus
              placeholder="12.50 keeps the sign"
              value={draft.amountInput}
              className={failed === "amount" ? "is-invalid" : undefined}
              onChange={(event) => updateDraft({ ...draftRef.current, amountInput: event.target.value })}
              onBlur={() => void persist("amount", draftRef.current)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="amount-hint">Type 12.50 to keep the sign. + or − changes it.</span>
          </div>
        ) : (
          <button type="button" className="cell-button is-num" onClick={() => begin("amount")}>
            {formatMoney(saved.amount, currency)}
          </button>
        )}
      </td>
      <td className="expenses-status">
        {status === "editing" ? "Editing…" : null}
        {status === "saved" ? "✓ Saved" : null}
        {status === "error" ? (
          <span className="expenses-fail">
            ⚠ Couldn&apos;t save
            <span className="expenses-fail-actions">
              <button type="button" onClick={() => failed && void persist(failed, draftRef.current)}>
                Try again
              </button>
              <span aria-hidden="true"> · </span>
              <button type="button" onClick={undo}>
                Undo change
              </button>
            </span>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Cell({
  field,
  label,
  editing,
  failed,
  onBegin,
  display,
  children,
}: {
  field: Field;
  label: string;
  editing: Field | null;
  failed: Field | null;
  onBegin: () => void;
  display: string;
  children: ReactNode;
}) {
  const open = editing === field || failed === field;
  return (
    <td>
      {open ? (
        children
      ) : (
        <button type="button" className="cell-button" aria-label={`${label}, ${display}`} onClick={onBegin}>
          {display}
        </button>
      )}
    </td>
  );
}
