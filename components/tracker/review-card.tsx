"use client";

import { confirmLabel, reviewIntro, REVIEW_FOOTER, totalLabel } from "@/lib/chat/copy";
import { formatMoney, formatRowDate } from "@/lib/chat/money";
import type { Proposal, ReviewRow } from "@/lib/chat/types";
import { flagLabel, revalidateRow, rowBlocksSave, rowsToSave } from "@/lib/chat/validate-rows";

type Phase = "review" | "edit" | "saved" | "undone" | "cancelled";

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
  const rows = proposal.rows;
  const saving = rowsToSave(rows);
  const blocked = saving.some(rowBlocksSave);
  const total = saving.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const showTotal = rows.some((row) => row.amount !== null);

  function update(index: number, patch: Partial<ReviewRow>) {
    onRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function doneEditing() {
    onRows(
      rows.map((row) =>
        revalidateRow(row, {
          categories: proposal.categories,
          banks: proposal.banks,
          existing: [],
        }),
      ),
    );
    onPhase("review");
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
      {phase === "saved" || phase === "undone" ? (
        <p className="tracker-card-status">
          {phase === "saved"
            ? `Saved ${saving.length} ${saving.length === 1 ? "transaction" : "transactions"}.`
            : `Removed ${saving.length === 1 ? "that transaction" : `those ${saving.length} transactions`}.`}
        </p>
      ) : (
        <p>{reviewIntro(rows.length, proposal.sourceName)}</p>
      )}
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Row
                  key={`${row.dateInput}-${row.description}-${index}`}
                  row={row}
                  editing={phase === "edit"}
                  currency={proposal.currency}
                  categories={proposal.categories}
                  banks={proposal.banks}
                  onChange={(patch) => update(index, patch)}
                  onRemove={() => onRows(rows.filter((_, rowIndex) => rowIndex !== index))}
                />
              ))}
            </tbody>
            {showTotal && (
              <tfoot>
                <tr>
                  <td colSpan={4}>{totalLabel(proposal.sourceName)}</td>
                  <td className="is-num">{formatMoney(total, proposal.currency)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {phase !== "saved" && phase !== "undone" && <p className="tracker-card-note">{REVIEW_FOOTER}</p>}
      {error && <p className="tracker-form-error">{error}</p>}
      <div className="tracker-card-actions">
        {phase === "review" && (
          <>
            <button
              type="button"
              className="tracker-confirm"
              disabled={busy || saving.length === 0 || blocked}
              onClick={onConfirm}
            >
              {confirmLabel(saving.length)}
            </button>
            <button type="button" className="tracker-quiet" disabled={busy} onClick={() => onPhase("edit")}>
              Edit
            </button>
            <button type="button" className="tracker-quiet" disabled={busy} onClick={() => onPhase("cancelled")}>
              Cancel
            </button>
          </>
        )}
        {phase === "edit" && (
          <>
            <button type="button" className="tracker-confirm" onClick={doneEditing}>
              Done
            </button>
            <button type="button" className="tracker-quiet" onClick={() => onPhase("cancelled")}>
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
  editing,
  currency,
  categories,
  banks,
  onChange,
  onRemove,
}: {
  row: ReviewRow;
  editing: boolean;
  currency: string;
  categories: string[];
  banks: Proposal["banks"];
  onChange: (patch: Partial<ReviewRow>) => void;
  onRemove: () => void;
}) {
  const skipped = row.flags.includes("duplicate") && row.includeDuplicate !== true;
  const flagged = row.flags.length > 0 && !skipped;
  const bankLabel = row.bank
    ? row.bankInitials
      ? `${row.bank} (${row.bankInitials})`
      : row.bank
    : "—";
  return (
    <>
      <tr className={skipped ? "is-skipped" : flagged ? "is-flagged" : undefined}>
        <td>
          {editing ? (
            <input
              aria-label="Date"
              value={row.dateInput}
              onChange={(event) => onChange({ dateInput: event.target.value })}
            />
          ) : row.date ? (
            formatRowDate(row.date)
          ) : (
            row.dateInput || "—"
          )}
        </td>
        <td>
          {editing ? (
            <input
              aria-label="Description"
              value={row.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          ) : (
            <span className="tracker-desc">
              {row.description || "—"}
              {row.flags.includes("duplicate") && (
                <span className={skipped ? "tracker-skip-pill" : "tracker-flag-pill"}>
                  {skipped ? "Skipped — already saved" : "Duplicate"}
                </span>
              )}
            </span>
          )}
        </td>
        <td>
          {editing ? (
            <select
              aria-label="Category"
              value={row.category}
              onChange={(event) => onChange({ category: event.target.value })}
            >
              <option value="">Choose</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
              {row.category && !categories.includes(row.category) && (
                <option value={row.category}>{row.category}</option>
              )}
            </select>
          ) : (
            <span className={row.flags.includes("unknown_category") ? "tracker-cat is-bad" : "tracker-cat"}>
              {row.category || "—"}
            </span>
          )}
        </td>
        <td>
          {editing ? (
            <select aria-label="Bank" value={row.bank} onChange={(event) => onChange({ bank: event.target.value })}>
              <option value="">Choose</option>
              {banks.map((bank) => (
                <option key={bank.name} value={bank.name}>
                  {bank.name}
                </option>
              ))}
            </select>
          ) : (
            bankLabel
          )}
        </td>
        <td className="is-num">
          {editing ? (
            <input
              aria-label="Amount"
              value={row.amountInput}
              onChange={(event) => onChange({ amountInput: event.target.value })}
            />
          ) : row.amount === null ? (
            row.amountInput || "—"
          ) : (
            formatMoney(row.amount, currency)
          )}
        </td>
      </tr>
      {(flagged || skipped || editing) && (
        <tr className={skipped ? "tracker-flag-row is-skipped" : "tracker-flag-row"}>
          <td colSpan={5}>
            {row.flags
              .filter((flag) => !(skipped && flag === "duplicate"))
              .map((flag) => (
                <span key={flag}>{flagLabel(flag)} </span>
              ))}
            {row.flags.includes("duplicate") && (
              <label className="tracker-include">
                <input
                  type="checkbox"
                  checked={row.includeDuplicate === true}
                  onChange={(event) => onChange({ includeDuplicate: event.target.checked })}
                />
                Include anyway
              </label>
            )}
            {editing && (
              <button type="button" className="tracker-remove" onClick={onRemove}>
                Remove row
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
