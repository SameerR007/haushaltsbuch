"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { missingPageBalanceNote, unreadablePageNote } from "@/lib/assistant/copy";
import { confirmLabel, REVIEW_FOOTER, REVIEW_NOTE, reviewIntro, totalLabel } from "@/lib/chat/copy";
import { amountKeepingSign, formatReviewAmount, formatRowDate } from "@/lib/chat/money";
import {
  balanceMismatchText,
  balancePassedText,
  blankStatementRow,
  reconcileBalances,
  skippedNote,
} from "@/lib/chat/statement";
import type { Proposal, ReviewRow } from "@/lib/chat/types";
import { editReviewRow, flagLabel, parseAmount, parseIsoDate, rowBlocksSave, rowsToSave } from "@/lib/chat/validate-rows";

type Phase = "review" | "edit" | "saved" | "undone" | "cancelled";

type Field = "date" | "description" | "category" | "bank" | "amount";

type Editing = { index: number; field: Field } | null;

export function ReviewCard({
  proposal,
  phase,
  busy,
  error,
  onRows,
  onPhase,
  onConfirm,
  onUndo,
}: {
  proposal: Proposal;
  phase: Phase;
  busy: boolean;
  error: string;
  onRows: (rows: ReviewRow[]) => void;
  onPhase: (phase: Phase) => void;
  onConfirm: () => void;
  onUndo: () => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const rows = proposal.rows;
  const saving = rowsToSave(rows);
  const blocked = saving.some(rowBlocksSave);
  const total = saving.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const showTotal = rows.some((row) => row.amount !== null);
  const reviewing = phase === "review" || phase === "edit";
  const statement = proposal.statement;
  const verdict =
    statement && statement.opening !== null && statement.closing !== null
      ? reconcileBalances(statement.opening, statement.closing, rows)
      : null;
  const skipped = statement ? skippedNote(statement) : null;

  function edit(index: number, patch: Partial<ReviewRow>) {
    onRows(
      rows.map((row, rowIndex) =>
        rowIndex === index ? editReviewRow(row, patch, { categories: proposal.categories, banks: proposal.banks }) : row,
      ),
    );
  }

  function patchOnly(index: number, patch: Partial<ReviewRow>) {
    onRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setEditing(null);
    onRows(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  if (phase === "cancelled") {
    return (
      <section className="tracker-card">
        <p>Cancelled. Nothing was saved.</p>
      </section>
    );
  }

  return (
    <section className="tracker-card" aria-label="Review transactions">
      {reviewing ? (
        <>
          <p>{reviewIntro(rows.length, proposal.sourceName)}</p>
          <div className="statement-banner is-check" role="note" data-testid="review-note">
            <p>{REVIEW_NOTE}</p>
          </div>
        </>
      ) : (
        <p className="tracker-card-status">
          {phase === "saved"
            ? `Saved ${saving.length} ${saving.length === 1 ? "transaction" : "transactions"}.`
            : `Removed ${saving.length === 1 ? "that transaction" : `those ${saving.length} transactions`}.`}
        </p>
      )}
      {reviewing && statement?.failedPage ? (
        <>
          <div className="statement-banner is-bad" role="status">
            <p>{linkAssistant(unreadablePageNote(statement.failedPage))}</p>
          </div>
          <p className="statement-pages">
            {statement.pages.map((page, index) => (
              <span key={page.page}>
                {index > 0 ? " · " : ""}
                Page {page.page} {page.status === "read" ? "✓" : page.status === "failed" ? "✕" : "not read"}
              </span>
            ))}
          </p>
          <p className="statement-quiet">{missingPageBalanceNote(statement.failedPage)}</p>
        </>
      ) : null}
      {reviewing && skipped ? (
        <div className="statement-banner is-warn" role="status">
          <p>{linkAssistant(skipped)}</p>
        </div>
      ) : null}
      {reviewing && verdict?.status === "pass" ? (
        <div className="statement-banner is-ok" role="status">
          <p>✓ {balancePassedText(verdict, proposal.currency)}</p>
        </div>
      ) : null}
      {reviewing && verdict?.status === "mismatch" ? (
        <div className="statement-banner is-warn" role="status">
          <p>{balanceMismatchText(verdict, proposal.currency)}</p>
        </div>
      ) : null}
      {rows.length > 0 && (
        <div className="tracker-table-wrap">
          <table className="tracker-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Bank</th>
                <th className="is-num">Amount</th>
                {reviewing ? (
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Row
                  key={index}
                  row={row}
                  reviewing={reviewing}
                  busy={busy}
                  editing={editing?.index === index ? editing.field : null}
                  currency={proposal.currency}
                  categories={proposal.categories}
                  banks={proposal.banks}
                  onBegin={(field) => setEditing({ index, field })}
                  onEnd={() => setEditing(null)}
                  onEdit={(patch) => edit(index, patch)}
                  onInclude={(includeDuplicate) => patchOnly(index, { includeDuplicate })}
                  onRemove={() => removeRow(index)}
                />
              ))}
            </tbody>
            {showTotal && (
              <tfoot>
                <tr>
                  <td colSpan={4}>{totalLabel(proposal.sourceName)}</td>
                  <td className="is-num">{formatReviewAmount(total, proposal.currency)}</td>
                  {reviewing ? <td /> : null}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {reviewing && verdict?.status === "mismatch" ? (
        <button type="button" className="statement-add" onClick={() => onRows([...rows, blankStatementRow(proposal)])}>
          + Add missing row
        </button>
      ) : null}
      {reviewing && <p className="tracker-card-note">{REVIEW_FOOTER}</p>}
      {error && <p className="tracker-form-error">{error}</p>}
      <div className="tracker-card-actions">
        {reviewing && (
          <>
            <button
              type="button"
              className="tracker-confirm"
              disabled={busy || saving.length === 0 || blocked}
              onClick={onConfirm}
            >
              {confirmLabel(saving.length)}
            </button>
            <button type="button" className="tracker-quiet" disabled={busy} onClick={() => onPhase("cancelled")}>
              Cancel
            </button>
          </>
        )}
        {phase === "saved" && (
          <button type="button" className="tracker-quiet" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
    </section>
  );
}

function Row({
  row,
  reviewing,
  busy,
  editing,
  currency,
  categories,
  banks,
  onBegin,
  onEnd,
  onEdit,
  onInclude,
  onRemove,
}: {
  row: ReviewRow;
  reviewing: boolean;
  busy: boolean;
  editing: Field | null;
  currency: string;
  categories: string[];
  banks: Proposal["banks"];
  onBegin: (field: Field) => void;
  onEnd: () => void;
  onEdit: (patch: Partial<ReviewRow>) => void;
  onInclude: (include: boolean) => void;
  onRemove: () => void;
}) {
  const [amountDraft, setAmountDraft] = useState("");
  const skipped = row.flags.includes("duplicate") && row.includeDuplicate !== true;
  const problems = row.flags.filter((flag) => flag !== "uncertain" && flag !== "duplicate");
  const flagged = problems.length > 0 && !skipped;
  const showFlagRow = flagged || row.flags.includes("duplicate");
  const canEdit = reviewing && !busy;
  const bankLabel = row.bank ? (row.bankInitials ? `${row.bank} (${row.bankInitials})` : row.bank) : "—";
  const dateLabel = row.date ? formatRowDate(row.date) : row.dateInput || "—";
  const amountLabel = row.amount === null ? row.amountInput || "—" : formatReviewAmount(row.amount, currency);

  function beginAmount() {
    setAmountDraft(row.amount === null ? row.amountInput : String(Math.abs(row.amount)));
    onBegin("amount");
  }

  function commitAmount() {
    const input = row.amount === null ? amountDraft.trim() : amountKeepingSign(amountDraft, row.amount);
    onEdit({ amountInput: input, amount: parseAmount(input) });
    onEnd();
  }

  return (
    <>
      <tr className={skipped ? "is-skipped" : flagged ? "is-flagged" : undefined}>
        <Cell
          label="Date"
          display={dateLabel}
          open={editing === "date"}
          canEdit={canEdit}
          onBegin={() => onBegin("date")}
        >
          <input
            aria-label="Date"
            type="date"
            autoFocus
            value={row.date ?? ""}
            onChange={(event) => onEdit({ dateInput: event.target.value, date: parseIsoDate(event.target.value) })}
            onBlur={onEnd}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Cell>
        <Cell
          label="Description"
          display={row.description || "—"}
          open={editing === "description"}
          canEdit={canEdit}
          onBegin={() => onBegin("description")}
          extra={
            <>
              {row.flags.includes("duplicate") && (
                <span className={skipped ? "tracker-skip-pill" : "tracker-flag-pill"}>
                  {skipped ? "Skipped — already saved" : "Duplicate"}
                </span>
              )}
              {row.note ? <span className="statement-note">{row.note}</span> : null}
            </>
          }
        >
          <input
            aria-label="Description"
            autoFocus
            value={row.description}
            onChange={(event) => onEdit({ description: event.target.value })}
            onBlur={onEnd}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Cell>
        <td>
          {editing === "category" ? (
            <select
              aria-label="Category"
              autoFocus
              value={categories.includes(row.category) ? row.category : ""}
              onChange={(event) => {
                onEdit({ category: event.target.value });
                onEnd();
              }}
              onBlur={onEnd}
            >
              {categories.includes(row.category) ? null : (
                <option value="" disabled>
                  Pick one
                </option>
              )}
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          ) : (
            <CellButton label="Category" display={row.category || "—"} canEdit={canEdit} onBegin={() => onBegin("category")}>
              <span className={row.flags.includes("unknown_category") ? "tracker-cat is-bad" : "tracker-cat"}>
                {row.category || "—"}
              </span>
            </CellButton>
          )}
        </td>
        <td>
          {editing === "bank" ? (
            <select
              aria-label="Bank"
              autoFocus
              value={banks.some((bank) => bank.name === row.bank) ? row.bank : ""}
              onChange={(event) => {
                const bank = banks.find((entry) => entry.name === event.target.value);
                if (bank) onEdit({ bank: bank.name, bankInitials: bank.initials });
                onEnd();
              }}
              onBlur={onEnd}
            >
              {banks.some((bank) => bank.name === row.bank) ? null : (
                <option value="" disabled>
                  Pick one
                </option>
              )}
              {banks.map((bank) => (
                <option key={bank.name} value={bank.name}>
                  {bank.name} ({bank.initials})
                </option>
              ))}
            </select>
          ) : (
            <CellButton label="Bank" display={bankLabel} canEdit={canEdit} onBegin={() => onBegin("bank")}>
              {bankLabel}
            </CellButton>
          )}
        </td>
        <td className="is-num">
          {editing === "amount" ? (
            <div className="amount-edit">
              <input
                aria-label="Amount"
                inputMode="decimal"
                autoFocus
                value={amountDraft}
                onFocus={(event) => event.currentTarget.select()}
                onMouseUp={(event) => event.preventDefault()}
                onChange={(event) => setAmountDraft(event.target.value)}
                onBlur={commitAmount}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              {row.amount !== null ? (
                <span className="amount-hint">Type 12.50 to keep the sign. + or − changes it.</span>
              ) : null}
            </div>
          ) : (
            <CellButton label="Amount" display={amountLabel} canEdit={canEdit} onBegin={beginAmount}>
              {amountLabel}
            </CellButton>
          )}
        </td>
        {reviewing ? (
          <td className="tracker-row-remove">
            <button
              type="button"
              className="tracker-remove"
              disabled={busy}
              aria-label={`Remove ${row.description || "row"}`}
              onClick={onRemove}
            >
              Remove
            </button>
          </td>
        ) : null}
      </tr>
      {reviewing && showFlagRow && (
        <tr className={skipped ? "tracker-flag-row is-skipped" : "tracker-flag-row"}>
          <td colSpan={6}>
            {problems.map((flag) => (
              <span key={flag}>{flagLabel(flag)} </span>
            ))}
            {row.flags.includes("duplicate") && !skipped ? <span>{flagLabel("duplicate")} </span> : null}
            {row.flags.includes("duplicate") && (
              <label className="tracker-include">
                <input
                  type="checkbox"
                  checked={row.includeDuplicate === true}
                  onChange={(event) => onInclude(event.target.checked)}
                />
                Include anyway
              </label>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Cell({
  label,
  display,
  open,
  canEdit,
  onBegin,
  extra,
  children,
}: {
  label: string;
  display: string;
  open: boolean;
  canEdit: boolean;
  onBegin: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <td>
      {open ? (
        children
      ) : (
        <span className="tracker-desc">
          <CellButton label={label} display={display} canEdit={canEdit} onBegin={onBegin}>
            {display}
          </CellButton>
          {extra}
        </span>
      )}
    </td>
  );
}

function CellButton({
  label,
  display,
  canEdit,
  onBegin,
  children,
}: {
  label: string;
  display: string;
  canEdit: boolean;
  onBegin: () => void;
  children: ReactNode;
}) {
  if (!canEdit) return <>{children}</>;
  return (
    <button type="button" className="cell-button" aria-label={`${label}, ${display}`} onClick={onBegin}>
      {children}
    </button>
  );
}

function linkAssistant(text: string) {
  const marker = "Change assistant";
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <Link href="/data/assistant">Change assistant</Link>
      {text.slice(index + marker.length)}
    </>
  );
}
