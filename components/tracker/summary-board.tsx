"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMoney, formatRowDate } from "@/lib/chat/money";
import {
  SUMMARY_EMPTY,
  SUMMARY_GO_CHAT,
  summaryAmountsNote,
  summaryEmptyRange,
  summaryOpensOn,
} from "@/lib/data/copy";
import { parseSummary, readSummaryError } from "@/lib/data/summary-parse";
import type { SummaryPayload, SummaryRow } from "@/lib/data/summary-types";
import {
  addDays,
  calendarCells,
  categoryComparison,
  changePercent,
  isoDate,
  magnitudeChange,
  monthRangeContaining,
  monthYearLabel,
  previousPeriod,
  rangeLabel,
  recentMonthRanges,
  sharePercent,
  wholeYearLabel,
  yearRange,
} from "@/lib/data/summary-range";

const CATEGORY_COLORS = ["#1c6b62", "#3c9a86", "#8fbf7a", "#c4a574", "#e07a4c", "#b7b1a8", "#5b8fa8", "#7a6a9a"];

type Picker = {
  kind: "main" | "compare";
  step: "start" | "end";
  month: string;
  start: string | null;
};

function colorFor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? "#1c6b62";
}

function money(amount: number, currency: string): string {
  return formatMoney(amount, currency);
}

function signedMoney(amount: number, currency: string): string {
  if (amount === 0) return `±${formatMoney(0, currency)}`;
  if (amount > 0) return `+${formatMoney(amount, currency)}`;
  return formatMoney(amount, currency);
}

function percentLabel(percent: number): string {
  const body = Number.isInteger(percent) ? String(Math.abs(percent)) : Math.abs(percent).toFixed(1);
  if (percent > 0) return `(+${body}%)`;
  if (percent < 0) return `(-${body}%)`;
  return `(±${body}%)`;
}

function tone(amount: number, kind: "expense" | "income" | "net"): string {
  if (amount === 0) return "is-flat";
  if (kind === "expense") return amount > 0 ? "is-down" : "is-up";
  return amount > 0 ? "is-up" : "is-down";
}

function bankLine(row: SummaryRow): string {
  return row.bankInitials ? `${row.bank} (${row.bankInitials})` : row.bank;
}

export function SummaryBoard() {
  const router = useRouter();
  const search = useSearchParams();
  const fromQ = search.get("from");
  const toQ = search.get("to");
  const compareFromQ = search.get("compareFrom");
  const compareToQ = search.get("compareTo");
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<Picker | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (fromQ && toQ) {
      params.set("from", fromQ);
      params.set("to", toQ);
    }
    if (compareFromQ && compareToQ) {
      params.set("compareFrom", compareFromQ);
      params.set("compareTo", compareToQ);
    }
    const query = params.toString();
    let ignore = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/summary${query ? `?${query}` : ""}`);
        const body: unknown = await response.json();
        if (ignore) return;
        const parsed = parseSummary(body);
        if (!response.ok || !parsed) {
          setSummary(null);
          setError(readSummaryError(body));
          return;
        }
        setSummary(parsed);
        setError("");
      } catch {
        if (!ignore) {
          setSummary(null);
          setError("Could not load the summary.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [fromQ, toQ, compareFromQ, compareToQ]);

  useEffect(() => {
    if (!picker) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPicker(null);
    }
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".summary-calendar") || target.closest(".summary-date")) return;
      setPicker(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [picker]);

  function visit(from: string, to: string, compareFrom: string, compareTo: string) {
    const params = new URLSearchParams({ from, to, compareFrom, compareTo });
    router.replace(`/app/summary?${params.toString()}`);
    setPicker(null);
  }

  function visitMain(from: string, to: string) {
    const previous = previousPeriod(from, to);
    if (!previous) return;
    visit(from, to, previous.from, previous.to);
  }

  function visitCompare(compareFrom: string, compareTo: string) {
    if (!summary?.from || !summary.to) return;
    visit(summary.from, summary.to, compareFrom, compareTo);
  }

  function openPicker(kind: "main" | "compare", step: "start" | "end") {
    const month = (step === "end"
      ? kind === "main"
        ? summary?.to
        : summary?.compareTo
      : kind === "main"
        ? summary?.from
        : summary?.compareFrom) ?? summary?.from;
    if (!month) return;
    const start = step === "end" ? (kind === "main" ? summary?.from ?? null : summary?.compareFrom ?? null) : null;
    setPicker({ kind, step, month, start });
  }

  function chooseDay(iso: string) {
    if (!picker) return;
    if (picker.step === "start") {
      setPicker({ ...picker, step: "end", start: iso, month: iso });
      return;
    }
    const start = picker.start ?? iso;
    const from = start <= iso ? start : iso;
    const to = start <= iso ? iso : start;
    if (picker.kind === "main") visitMain(from, to);
    else visitCompare(from, to);
  }

  function shiftPicker(delta: number) {
    if (!picker) return;
    const range = monthRangeContaining(picker.month);
    if (!range) return;
    const next = addDays(delta > 0 ? range.to : range.from, delta);
    if (next) setPicker({ ...picker, month: next });
  }

  const currency = summary?.currency ?? "";
  const hasRange = Boolean(summary?.from && summary?.to);
  const hasRows = Boolean(summary && (summary.incomeRows.length > 0 || summary.categories.length > 0));
  const months = summary?.latestFrom ? recentMonthRanges(summary.latestFrom) : [];
  const year = summary?.from ? yearRange(summary.from) : summary?.latestFrom ? yearRange(summary.latestFrom) : null;
  const expenseDelta = summary ? magnitudeChange(summary.expenses, summary.compareExpenses) : 0;
  const expensePercent = summary
    ? changePercent(expenseDelta, Math.abs(summary.compareExpenses))
    : null;
  const incomeDelta = summary ? summary.income - summary.compareIncome : 0;
  const netDelta = summary ? summary.net - summary.compareNet : 0;
  const compared = summary ? categoryComparison(summary.categories, summary.compareCategories) : [];

  return (
    <main className="summary">
      <div className="summary-toolbar">
        <div className="summary-controls">
          <DateField
            kicker="From"
            value={summary?.from ? formatRowDate(summary.from) : "—"}
            onClick={() => openPicker("main", "start")}
          />
          <span className="summary-arrow" aria-hidden="true">
            →
          </span>
          <DateField
            kicker="To"
            value={summary?.to ? formatRowDate(summary.to) : "—"}
            onClick={() => openPicker("main", "end")}
          />
          <div className="summary-chips">
            {months.map((month) => {
              const selected = summary?.from === month.from && summary?.to === month.to;
              return (
                <button
                  key={month.from}
                  type="button"
                  className={selected ? "summary-chip is-selected" : "summary-chip"}
                  onClick={() => visitMain(month.from, month.to)}
                >
                  {monthYearLabel(month.from)}
                </button>
              );
            })}
            {year ? (
              <button
                type="button"
                className={summary?.from === year.from && summary?.to === year.to ? "summary-chip is-selected" : "summary-chip"}
                onClick={() => visitMain(year.from, year.to)}
              >
                {wholeYearLabel(Number(year.from.slice(0, 4)))}
              </button>
            ) : null}
          </div>
        </div>
        {picker?.kind === "main" ? (
          <Calendar
            month={picker.month}
            start={picker.step === "end" ? picker.start : summary?.from ?? null}
            end={picker.step === "end" ? picker.start : summary?.to ?? null}
            onShift={shiftPicker}
            onPick={chooseDay}
          />
        ) : null}
      </div>

      <div className="summary-meta">
        {summary?.latestFrom && summary.latestTo ? (
          <p>{summaryOpensOn(rangeLabel(summary.latestFrom, summary.latestTo))}</p>
        ) : (
          <p />
        )}
        {summary?.currencyLabel ? <p>{summaryAmountsNote(summary.currencyLabel)}</p> : null}
      </div>

      {error ? (
        <p className="summary-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !summary ? <p className="summary-status">Loading summary…</p> : null}

      {summary && hasRange && !hasRows ? (
        <div className="summary-empty">
          <p>{summary.from && summary.to ? summaryEmptyRange(rangeLabel(summary.from, summary.to)) : SUMMARY_EMPTY}</p>
          <Link className="expenses-go-chat" href="/app">
            {SUMMARY_GO_CHAT}
          </Link>
        </div>
      ) : null}

      {summary && !hasRange && !loading ? (
        <div className="summary-empty">
          <p>{SUMMARY_EMPTY}</p>
          <Link className="expenses-go-chat" href="/app">
            {SUMMARY_GO_CHAT}
          </Link>
        </div>
      ) : null}

      {summary && hasRows && currency ? (
        <>
          <section className="summary-cards">
            <TotalCard
              label="Income"
              amount={signedMoney(summary.income, currency).replace(/^\+/, "")}
              delta={signedMoney(incomeDelta, currency)}
              extra=""
              versus={money(summary.compareIncome, currency)}
              className={tone(incomeDelta, "income")}
              amountClass="is-income"
            />
            <TotalCard
              label="Expenses"
              amount={money(Math.abs(summary.expenses), currency)}
              delta={signedMoney(expenseDelta, currency)}
              extra={expensePercent === null ? "" : ` ${percentLabel(expensePercent)}`}
              versus={money(Math.abs(summary.compareExpenses), currency)}
              className={tone(expenseDelta, "expense")}
              amountClass="is-expense"
            />
            <TotalCard
              label="Net"
              amount={signedMoney(summary.net, currency)}
              delta={signedMoney(netDelta, currency)}
              extra=""
              versus={signedMoney(summary.compareNet, currency)}
              className={tone(netDelta, "net")}
              amountClass="is-net"
            />
          </section>

          <section className="summary-split">
            <article className="summary-panel">
              <h2>Spending by category</h2>
              <div className="summary-donut-row">
                <Donut
                  parts={summary.categories.map((row, index) => ({
                    color: colorFor(index),
                    fraction: Math.abs(summary.expenses) === 0 ? 0 : Math.abs(row.amount) / Math.abs(summary.expenses),
                  }))}
                  total={money(Math.abs(summary.expenses), currency)}
                />
                <ul className="summary-legend">
                  {summary.categories.map((row, index) => (
                    <li key={row.category}>
                      <span className="summary-swatch" style={{ background: colorFor(index) }} />
                      <span className="summary-legend-name">{row.category}</span>
                      <span className="summary-legend-pct">{sharePercent(row.amount, summary.expenses)}%</span>
                      <span className="summary-legend-amt">{money(Math.abs(row.amount), currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
            <article className="summary-panel">
              <h2>Income</h2>
              <ul className="summary-lines">
                {summary.incomeRows.map((row) => (
                  <li key={row.id}>
                    <div>
                      <p className="summary-line-title">{row.category}</p>
                      <p className="summary-line-sub">
                        {formatRowDate(row.date)} · {bankLine(row)}
                      </p>
                    </div>
                    <span className="is-up">{signedMoney(row.amount, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="summary-line-total">
                <span>Total income</span>
                <span className="is-up">{signedMoney(summary.income, currency)}</span>
              </p>
            </article>
          </section>

          <section className="summary-panel">
            <h2>Largest expenses</h2>
            <ul className="summary-lines">
              {summary.largest.map((row) => (
                <li key={row.id}>
                  <Link href={`/app/expenses?focus=${row.id}`}>
                    <p className="summary-line-title">{formatRowDate(row.date)}</p>
                    <p className="summary-line-sub">
                      {row.notes?.trim() || "—"} · {row.category} · {row.bankInitials || row.bank}
                    </p>
                  </Link>
                  <span>{money(row.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="summary-panel">
            <h2>Compare two periods</h2>
            {picker?.kind === "compare" ? (
              <Calendar
                month={picker.month}
                start={picker.step === "end" ? picker.start : summary.compareFrom}
                end={picker.step === "end" ? picker.start : summary.compareTo}
                onShift={shiftPicker}
                onPick={chooseDay}
              />
            ) : null}
            <div className="summary-periods">
              <div>
                <p className="summary-period-label">Period A</p>
                <DateField kicker="From" value={summary.from ? formatRowDate(summary.from) : "—"} onClick={() => openPicker("main", "start")} />
                <span className="summary-to">to</span>
                <DateField kicker="To" value={summary.to ? formatRowDate(summary.to) : "—"} onClick={() => openPicker("main", "end")} />
              </div>
              <div>
                <p className="summary-period-label">Period B</p>
                <DateField
                  kicker="From"
                  value={summary.compareFrom ? formatRowDate(summary.compareFrom) : "—"}
                  onClick={() => openPicker("compare", "start")}
                />
                <span className="summary-to">to</span>
                <DateField
                  kicker="To"
                  value={summary.compareTo ? formatRowDate(summary.compareTo) : "—"}
                  onClick={() => openPicker("compare", "end")}
                />
              </div>
            </div>
            <div className="summary-table-wrap">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="is-num">Period A</th>
                    <th className="is-num">Period B</th>
                    <th className="is-num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="summary-group">
                    <th colSpan={4}>Expenses</th>
                  </tr>
                  {compared.map((row) => {
                    const delta = magnitudeChange(row.periodA, row.periodB);
                    return (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td className="is-num">{money(Math.abs(row.periodA), currency)}</td>
                        <td className="is-num">{money(Math.abs(row.periodB), currency)}</td>
                        <td className={`is-num ${tone(delta, "expense")}`}>{signedMoney(delta, currency)}</td>
                      </tr>
                    );
                  })}
                  <tr className="summary-total">
                    <td>Total expenses</td>
                    <td className="is-num">{money(Math.abs(summary.expenses), currency)}</td>
                    <td className="is-num">{money(Math.abs(summary.compareExpenses), currency)}</td>
                    <td className={`is-num ${tone(expenseDelta, "expense")}`}>{signedMoney(expenseDelta, currency)}</td>
                  </tr>
                  <tr>
                    <td>Income</td>
                    <td className="is-num">{money(summary.income, currency)}</td>
                    <td className="is-num">{money(summary.compareIncome, currency)}</td>
                    <td className={`is-num ${tone(incomeDelta, "income")}`}>{signedMoney(incomeDelta, currency)}</td>
                  </tr>
                  <tr className="summary-total">
                    <td>Net</td>
                    <td className="is-num">{signedMoney(summary.net, currency)}</td>
                    <td className="is-num">{signedMoney(summary.compareNet, currency)}</td>
                    <td className={`is-num ${tone(netDelta, "net")}`}>{signedMoney(netDelta, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function DateField({ kicker, value, onClick }: { kicker: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="summary-date" onClick={onClick}>
      <span>{kicker}</span>
      {value}
    </button>
  );
}

function Calendar({
  month,
  start,
  end,
  onShift,
  onPick,
}: {
  month: string;
  start: string | null;
  end: string | null;
  onShift: (delta: number) => void;
  onPick: (iso: string) => void;
}) {
  const range = monthRangeContaining(month);
  if (!range) return null;
  const [year, monthNumber] = range.from.split("-").map(Number);
  const earlier = addDays(range.from, -1);
  const later = addDays(range.to, 1);
  const low = start && end ? (start < end ? start : end) : start;
  const high = start && end ? (start < end ? end : start) : start;
  return (
    <div className="summary-calendar" role="dialog" aria-label={monthYearLabel(range.from)}>
      <div className="summary-calendar-head">
        <button type="button" onClick={() => onShift(-1)} aria-label={earlier ? monthYearLabel(earlier) : "Earlier"}>
          ‹
        </button>
        <strong>{monthYearLabel(range.from)}</strong>
        <button type="button" onClick={() => onShift(1)} aria-label={later ? monthYearLabel(later) : "Later"}>
          ›
        </button>
      </div>
      <div className="summary-calendar-grid summary-calendar-week" aria-hidden="true">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="summary-calendar-grid">
        {calendarCells(year, monthNumber).map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const iso = isoDate(year, monthNumber, day);
          const selected = iso === start || iso === end;
          const inside = Boolean(low && high && iso >= low && iso <= high);
          const className = selected ? "is-selected" : inside ? "is-inside" : undefined;
          return (
            <button key={iso} type="button" className={className} onClick={() => onPick(iso)}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Donut({ parts, total }: { parts: { color: string; fraction: number }[]; total: string }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="summary-donut">
      <svg viewBox="0 0 160 160" width="168" height="168" aria-hidden="true">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#efeae3" strokeWidth="18" />
        {parts.map((part, index) => {
          const length = Math.max(0, part.fraction) * circumference;
          const node = (
            <circle
              key={part.color + index}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={part.color}
              strokeWidth="18"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return node;
        })}
      </svg>
      <p>
        <strong>{total}</strong>
        <span>Expenses</span>
      </p>
    </div>
  );
}

function TotalCard({
  label,
  amount,
  delta,
  extra,
  versus,
  className,
  amountClass,
}: {
  label: string;
  amount: string;
  delta: string;
  extra: string;
  versus: string;
  className: string;
  amountClass: string;
}) {
  return (
    <article className="summary-card">
      <p className="summary-card-label">{label}</p>
      <p className={`summary-card-amount ${amountClass}`}>{amount}</p>
      <p className={`summary-card-delta ${className}`}>
        {delta}
        {extra} vs Period B ({versus})
      </p>
    </article>
  );
}
