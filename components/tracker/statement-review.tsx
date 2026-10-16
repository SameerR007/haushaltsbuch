"use client";

import Link from "next/link";
import { useState } from "react";
import {
  LOCAL_REVIEW_NOTE,
  missingPageBalanceNote,
  unreadablePageNote,
} from "@/lib/assistant/copy";
import {
  balanceMismatchText,
  balancePassedText,
  blankStatementRow,
  reconcileBalances,
  shortStatementDate,
  skippedNote,
  statementSubtitle,
  statementTitle,
} from "@/lib/chat/statement";
import { formatReviewAmount } from "@/lib/chat/money";
import type { Proposal, ReviewRow, RowFlag } from "@/lib/chat/types";
import { parseAmount, parseIsoDate, rowBlocksSave, rowsToSave } from "@/lib/chat/validate-rows";

export function StatementReview({
  proposal,
  busy,
  error,
  onRows,
  onPhase,
  onConfirm,
}: {
  proposal: Proposal;
  busy: boolean;
  error: string;
  onRows: (rows: ReviewRow[]) => void;
  onPhase: (phase: "cancelled") => void;
  onConfirm: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const statement = proposal.statement;
  if (!statement) return null;
  const rows = proposal.rows;
  const saving = rowsToSave(rows);
  const blocked = saving.some(rowBlocksSave);
  const verdict =
    statement.opening !== null && statement.closing !== null
      ? reconcileBalances(statement.opening, statement.closing, rows)
      : null;
  const mismatch = verdict?.status === "mismatch";
  const count = saving.length;
  const title = statementTitle(rows.length, proposal.sourceName, statement);
  const subtitle = statementSubtitle(proposal.sourceName, statement);
  const skipped = skippedNote(statement);

  function update(index: number, patch: Partial<ReviewRow>) {
    onRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function editAmount(index: number, value: string) {
    const row = rows[index];
    if (!row) return;
    const amount = parseAmount(value);
    const flags: RowFlag[] = row.flags.filter((flag) => flag !== "invalid_amount");
    if (amount === null) flags.push("invalid_amount");
    update(index, { amountInput: value, amount, flags });
  }

  function editCategory(index: number, value: string) {
    const flags: RowFlag[] = (rows[index]?.flags ?? []).filter((flag) => flag !== "unknown_category");
    update(index, { category: value, flags });
  }

  function editBank(index: number, value: string) {
    const bank = proposal.banks.find((entry) => entry.name === value);
    if (!bank) return;
    const flags: RowFlag[] = (rows[index]?.flags ?? []).filter((flag) => flag !== "unknown_bank");
    update(index, { bank: bank.name, bankInitials: bank.initials, flags });
  }

  function removeRow(index: number) {
    setEditing(null);
    onRows(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function editDate(index: number, value: string) {
    const row = rows[index];
    if (!row) return;
    const date = parseIsoDate(value);
    const flags: RowFlag[] = row.flags.filter((flag) => flag !== "invalid_date");
    if (!date) flags.push("invalid_date");
    update(index, { dateInput: value, date, flags });
  }

  return (
    <section className="tracker-card statement-card" aria-label="Review statement">
      <h2 className="statement-title">{title}</h2>
      <p className="statement-sub">{subtitle}</p>
      <div className="statement-banner is-check" role="note" data-testid="local-review-note">
        <p>{LOCAL_REVIEW_NOTE}</p>
      </div>
      {statement.failedPage ? (
        <>
          <div className="statement-banner is-bad" role="status">
            <p>{linkAssistant(unreadablePageNote(statement.failedPage))}</p>
          </div>
          <p className="statement-pages">
            {statement.pages.map((page, index) => (
              <span key={page.page}>
                {index > 0 ? " · " : ""}
                Page {page.page}{" "}
                {page.status === "read" ? "✓" : page.status === "failed" ? "✕" : "not read"}
              </span>
            ))}
          </p>
          <p className="statement-quiet">{missingPageBalanceNote(statement.failedPage)}</p>
        </>
      ) : null}
      {skipped ? (
        <div className="statement-banner is-warn" role="status">
          <p>{linkAssistant(skipped)}</p>
        </div>
      ) : null}
      {verdict?.status === "pass" ? (
        <div className="statement-banner is-ok" role="status">
          <p>✓ {balancePassedText(verdict, proposal.currency)}</p>
        </div>
      ) : null}
      {verdict?.status === "mismatch" ? (
        <div className="statement-banner is-warn" role="status">
          <p>{balanceMismatchText(verdict, proposal.currency)}</p>
        </div>
      ) : null}
      <div className="tracker-table-wrap">
        <table className="tracker-table statement-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="is-num">Amount</th>
              <th>In/out</th>
              <th>Category</th>
              {proposal.banks.length > 1 ? <th>Bank</th> : null}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const open = editing === index || row.draft === true;
              const uncertain = row.flags.includes("uncertain");
              const needsFix = rowBlocksSave(row);
              const amount = row.amount;
              const rowClass = [open ? "is-editing" : "", uncertain ? "is-uncertain" : "", needsFix ? "is-flagged" : ""]
                .filter(Boolean)
                .join(" ");
              if (open) {
                return (
                  <tr key={`${index}-edit`} className={rowClass}>
                    <td>
                      <input
                        type="date"
                        aria-label="Date"
                        className="statement-date"
                        value={row.date ?? ""}
                        onChange={(event) => editDate(index, event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Description"
                        value={row.description}
                        onChange={(event) => update(index, { description: event.target.value })}
                      />
                    </td>
                    <td className="is-num">
                      <input
                        aria-label="Amount"
                        className="statement-amount"
                        inputMode="decimal"
                        value={row.amountInput}
                        onChange={(event) => editAmount(index, event.target.value)}
                      />
                    </td>
                    <td>
                      {amount === null ? (
                        "—"
                      ) : (
                        <span className={amount >= 0 ? "statement-in" : "statement-out"}>{amount >= 0 ? "In" : "Out"}</span>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label="Category"
                        value={proposal.categories.includes(row.category) ? row.category : ""}
                        onChange={(event) => editCategory(index, event.target.value)}
                      >
                        {proposal.categories.includes(row.category) ? null : (
                          <option value="" disabled>
                            Pick one
                          </option>
                        )}
                        {proposal.categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    {proposal.banks.length > 1 ? (
                      <td>
                        <select
                          aria-label="Bank"
                          value={proposal.banks.some((bank) => bank.name === row.bank) ? row.bank : ""}
                          onChange={(event) => editBank(index, event.target.value)}
                        >
                          {proposal.banks.some((bank) => bank.name === row.bank) ? null : (
                            <option value="" disabled>
                              Pick one
                            </option>
                          )}
                          {proposal.banks.map((bank) => (
                            <option key={bank.name} value={bank.name}>
                              {bank.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td className="statement-row-actions">
                      <button
                        type="button"
                        className="statement-row-button is-done"
                        onClick={() => {
                          if (row.draft) {
                            update(index, { draft: false, flags: row.flags.filter((flag) => flag !== "uncertain") });
                          }
                          setEditing(null);
                        }}
                      >
                        Done
                      </button>
                      <button type="button" className="statement-row-button" onClick={() => removeRow(index)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={`${index}-view`} className={rowClass || undefined}>
                  <td className="statement-date-cell">{row.date ? shortStatementDate(row.date) : row.dateInput || "—"}</td>
                  <td>
                    <span className="tracker-desc">
                      {row.description || "—"}
                      {needsFix ? <span className="statement-badge is-bad">Needs a fix</span> : null}
                      {uncertain ? <span className="statement-badge">Uncertain</span> : null}
                    </span>
                    {row.note ? <span className="statement-note">{row.note}</span> : null}
                  </td>
                  <td className="is-num statement-amount-cell">
                    {amount === null ? row.amountInput || "—" : formatReviewAmount(amount, proposal.currency)}
                  </td>
                  <td>
                    {amount === null ? (
                      "—"
                    ) : (
                      <span className={amount >= 0 ? "statement-in" : "statement-out"}>{amount >= 0 ? "In" : "Out"}</span>
                    )}
                  </td>
                  <td>
                    <span className={row.flags.includes("unknown_category") ? "tracker-cat is-bad" : "tracker-cat"}>
                      {row.category || "—"}
                    </span>
                  </td>
                  {proposal.banks.length > 1 ? <td>{row.bankInitials ?? (row.bank || "—")}</td> : null}
                  <td className="statement-row-actions">
                    <button
                      type="button"
                      className="statement-row-button"
                      aria-label={`Edit ${row.description || "row"}`}
                      disabled={busy}
                      onClick={() => setEditing(index)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mismatch ? (
        <button type="button" className="statement-add" onClick={() => onRows([...rows, blankStatementRow(proposal)])}>
          + Add missing row
        </button>
      ) : null}
      {error ? <p className="tracker-form-error">{error}</p> : null}
      <div className="tracker-card-actions">
        <button type="button" className="tracker-confirm" disabled={busy || count === 0 || blocked} onClick={onConfirm}>
          {`Add ${count} ${count === 1 ? "row" : "rows"}`}
        </button>
        <button type="button" className="tracker-quiet" disabled={busy} onClick={() => onPhase("cancelled")}>
          Discard
        </button>
      </div>
    </section>
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
