"use client";

import Link from "next/link";
import {
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
import type { Proposal, ReviewRow, RowFlag } from "@/lib/chat/types";
import { parseAmount, parseIsoDate, rowBlocksSave, rowsToSave } from "@/lib/chat/validate-rows";
import { formatSignedAmount } from "@/lib/chat/statement";

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const uncertain = row.flags.includes("uncertain") || row.draft === true;
              const amount = row.amount;
              return (
                <tr key={`${row.dateInput}-${row.description}-${index}`} className={uncertain ? "is-uncertain" : undefined}>
                  <td>
                    {row.draft ? (
                      <input
                        aria-label="Date"
                        value={row.dateInput}
                        placeholder="YYYY-MM-DD"
                        onChange={(event) => editDate(index, event.target.value)}
                      />
                    ) : row.date ? (
                      shortStatementDate(row.date)
                    ) : (
                      row.dateInput || "—"
                    )}
                  </td>
                  <td>
                    {row.draft ? (
                      <input
                        aria-label="Description"
                        value={row.description}
                        onChange={(event) => update(index, { description: event.target.value })}
                      />
                    ) : (
                      <span className="tracker-desc">
                        {row.description || "—"}
                        {uncertain ? <span className="statement-badge">Uncertain</span> : null}
                        {row.note ? <span className="statement-note">{row.note}</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="is-num">
                    {uncertain ? (
                      <input
                        aria-label="Amount"
                        className="statement-amount"
                        value={row.amountInput}
                        onChange={(event) => editAmount(index, event.target.value)}
                      />
                    ) : amount === null ? (
                      row.amountInput || "—"
                    ) : (
                      formatSignedAmount(amount, proposal.currency)
                    )}
                  </td>
                  <td>
                    {amount === null ? (
                      "—"
                    ) : (
                      <span className={amount >= 0 ? "statement-in" : "statement-out"}>{amount >= 0 ? "In" : "Out"}</span>
                    )}
                  </td>
                  <td>
                    {row.draft ? (
                      <select
                        aria-label="Category"
                        value={row.category}
                        onChange={(event) => update(index, { category: event.target.value })}
                      >
                        {proposal.categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="tracker-cat">{row.category || "—"}</span>
                    )}
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
          {mismatch ? `Add ${count} rows anyway` : `Add ${count} ${count === 1 ? "row" : "rows"}`}
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
