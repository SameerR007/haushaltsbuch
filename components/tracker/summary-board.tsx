"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatPlainDate, formatRowDate, formatSummaryMoney } from "@/lib/chat/money";
import {
  SUMMARY_COMPARE,
  SUMMARY_COMPARE_LEAD,
  SUMMARY_ONE_LEAD,
  SUMMARY_COMPARE_LEGEND,
  SUMMARY_EMPTY,
  SUMMARY_GO_CHAT,
  SUMMARY_NET_NOTE,
  SUMMARY_ONE,
  SUMMARY_UPDATING,
  incomeCountLabel,
  summaryAmountsNote,
  summaryEmptyRange,
  summaryOpensOn,
  transactionCountLabel,
} from "@/lib/data/copy";
import { parseCompareSummary, parsePeriodSummary, readSummaryError } from "@/lib/data/summary-parse";
import {
  applySingleDate,
  clickRangeDay,
  compareSearch,
  initialCompare,
  moveCalendarDay,
  openRangeDraft,
  periodSearch,
  previewRange,
  readSummaryView,
  writeSummaryView,
  type CompareRanges,
  type DateRange,
  type RangeDraft,
  type SummaryMode,
} from "@/lib/data/summary-state";
import type { CompareSummary, PeriodSummary, SummaryRow } from "@/lib/data/summary-types";
import {
  addDays,
  calendarCells,
  categoryComparison,
  formatPeriodChangeText,
  isoDate,
  monthRangeContaining,
  periodChange,
  monthYearLabel,
  plainRangeLabel,
  recentMonthRanges,
  sharePercent,
  wholeYearLabel,
  yearRange,
} from "@/lib/data/summary-range";

const CATEGORY_COLORS = ["#1c6b62", "#3c9a86", "#8fbf7a", "#c4a574", "#e07a4c", "#b7b1a8", "#5b8fa8", "#7a6a9a"];
const MINUS = "\u2212";

type SingleField = "a-from" | "a-to" | "b-from" | "b-to";

type SinglePicker = {
  field: SingleField;
  month: string;
};

function colorFor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? "#1c6b62";
}

function money(amount: number, currency: string): string {
  return formatSummaryMoney(amount, currency);
}

function signedMoney(amount: number, currency: string): string {
  if (amount === 0) return `±${formatMoney(0, currency)}`;
  if (amount > 0) return `+${formatMoney(amount, currency)}`;
  return formatSummaryMoney(amount, currency);
}

function tone(amount: number, kind: "expense" | "income" | "net"): string {
  if (amount === 0) return "is-flat";
  if (kind === "expense") return amount > 0 ? "is-down" : "is-up";
  return amount > 0 ? "is-up" : "is-down";
}

function ChangeCells({
  periodA,
  periodB,
  basis,
  kind,
  currency,
  moneyA,
  moneyB,
}: {
  periodA: number;
  periodB: number;
  basis: "magnitude" | "signed";
  kind: "expense" | "income" | "net";
  currency: string;
  moneyA: string;
  moneyB: string;
}) {
  const change = periodChange(periodA, periodB, basis);
  return (
    <>
      <td className="is-num">{moneyA}</td>
      <td className="is-num">{moneyB}</td>
      <td className={`is-num ${tone(change.amount, kind)}`}>{formatPeriodChangeText(change, currency)}</td>
    </>
  );
}

function bankLine(row: SummaryRow): string {
  return row.bankInitials ? `${row.bank} (${row.bankInitials})` : row.bank;
}

function expenseDetail(row: SummaryRow): string {
  const note = row.notes?.trim() || "—";
  const bank = row.bankInitials || row.bank;
  return `${note} — ${row.category} · ${bank}`;
}

export function SummaryBoard() {
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<SummaryMode>("one");
  const [one, setOne] = useState<DateRange | null>(null);
  const [compare, setCompare] = useState<CompareRanges | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const stored = readSummaryView();
    setMode(stored.mode);
    setOne(stored.one);
    setCompare(stored.compare);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeSummaryView({ v: 1, mode, one, compare });
  }, [hydrated, mode, one, compare]);

  useEffect(() => {
    if (!hydrated || mode !== "compare" || compare || !one) return;
    const seeded = initialCompare(one);
    if (seeded) setCompare(seeded);
  }, [hydrated, mode, compare, one]);

  function selectMode(next: SummaryMode) {
    setMode(next);
    if (next !== "compare" || compare || !one) return;
    const seeded = initialCompare(one);
    if (seeded) setCompare(seeded);
  }

  return (
    <main className="summary">
      <div className="summary-modes">
        <div className="summary-switch" role="radiogroup" aria-label="Summary view">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "one"}
            className={mode === "one" ? "summary-mode is-selected" : "summary-mode"}
            onClick={() => selectMode("one")}
          >
            {SUMMARY_ONE}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "compare"}
            className={mode === "compare" ? "summary-mode is-selected" : "summary-mode"}
            onClick={() => selectMode("compare")}
          >
            {SUMMARY_COMPARE}
          </button>
        </div>
      </div>
      {hydrated ? (
        <>
          <div className="summary-view" hidden={mode !== "one"}>
            <OnePeriod range={one} onRange={setOne} onEmpty={setEmpty} />
          </div>
          <div className="summary-view" hidden={mode !== "compare"}>
            <ComparePeriods compare={compare} onCompare={setCompare} empty={empty} />
          </div>
        </>
      ) : (
        <p className="summary-status">Loading summary…</p>
      )}
    </main>
  );
}

function OnePeriod({
  range,
  onRange,
  onEmpty,
}: {
  range: DateRange | null;
  onRange: (range: DateRange) => void;
  onEmpty: (empty: boolean) => void;
}) {
  const applied = useRef<string | null>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<RangeDraft | null>(null);
  const [anchor, setAnchor] = useState<"from" | "to" | null>(null);

  const from = range?.from ?? "";
  const to = range?.to ?? "";

  useEffect(() => {
    const key = from && to ? `${from}:${to}` : "default";
    if (applied.current === key) return;
    let ignore = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/summary?${periodSearch(from && to ? { from, to } : null)}`);
        const body: unknown = await response.json();
        if (ignore) return;
        const parsed = parsePeriodSummary(body);
        if (!response.ok || !parsed) {
          setSummary(null);
          setError(readSummaryError(body));
          return;
        }
        setSummary(parsed);
        setError("");
        onEmptyRef.current(!parsed.from || !parsed.to);
        if (!from && !to && parsed.from && parsed.to) {
          applied.current = `${parsed.from}:${parsed.to}`;
          onRangeRef.current({ from: parsed.from, to: parsed.to });
        } else {
          applied.current = key;
        }
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
  }, [from, to]);

  useDismiss(picker !== null, () => setPicker(null));

  function commit(next: DateRange) {
    setPicker(null);
    setAnchor(null);
    if (range && range.from === next.from && range.to === next.to) return;
    onRange(next);
  }

  function chooseDay(iso: string) {
    if (!picker) return;
    const result = clickRangeDay(picker, iso);
    if (result.kind === "draft") {
      setPicker(result.draft);
      return;
    }
    commit(result.range);
  }

  function openRange(edge: "from" | "to", month: string) {
    if (picker && anchor === edge) {
      setPicker(null);
      setAnchor(null);
      return;
    }
    setAnchor(edge);
    setPicker((current) => current ?? openRangeDraft(month));
  }

  const currency = summary?.currency ?? "";
  const hasRange = Boolean(summary?.from && summary?.to);
  const hasData = Boolean(summary?.latestFrom);
  const active = Boolean(summary && (summary.incomeCount > 0 || summary.expenseCount > 0));
  const months = summary?.latestFrom ? recentMonthRanges(summary.latestFrom) : [];
  const yearSource = summary?.from ?? summary?.latestFrom ?? null;
  const year = yearSource ? yearRange(yearSource) : null;
  const showing = summary?.from && summary?.to ? plainRangeLabel(summary.from, summary.to) : "";
  const preview = picker ? previewRange(picker.step === "end" ? null : range, picker, null) : null;

  return (
    <div aria-busy={loading}>
      {hasData ? (
        <>
          <div className="summary-toolbar">
            <div className="summary-controls">
              <DateField
                kicker="From"
                value={summary?.from ? formatPlainDate(summary.from) : "—"}
                open={anchor === "from"}
                onClick={() => openRange("from", summary?.from ?? summary?.latestFrom ?? "")}
                calendar={
                  picker && anchor === "from" ? (
                    <RangeCalendar
                      picker={picker}
                      preview={preview}
                      onPicker={setPicker}
                      onPick={chooseDay}
                      onClose={() => {
                        setPicker(null);
                        setAnchor(null);
                      }}
                    />
                  ) : null
                }
              />
              <span className="summary-arrow" aria-hidden="true">
                →
              </span>
              <DateField
                kicker="To"
                value={summary?.to ? formatPlainDate(summary.to) : "—"}
                open={anchor === "to"}
                onClick={() => openRange("to", summary?.to ?? summary?.from ?? "")}
                calendar={
                  picker && anchor === "to" ? (
                    <RangeCalendar
                      picker={picker}
                      preview={preview}
                      onPicker={setPicker}
                      onPick={chooseDay}
                      onClose={() => {
                        setPicker(null);
                        setAnchor(null);
                      }}
                    />
                  ) : null
                }
              />
              <div className="summary-chips">
                {months.map((month) => {
                  const selected = summary?.from === month.from && summary?.to === month.to;
                  return (
                    <button
                      key={month.from}
                      type="button"
                      className={selected ? "summary-chip is-selected" : "summary-chip"}
                      onClick={() => commit(month)}
                    >
                      {monthYearLabel(month.from)}
                    </button>
                  );
                })}
                {year ? (
                  <button
                    type="button"
                    className={
                      summary?.from === year.from && summary?.to === year.to
                        ? "summary-chip is-selected"
                        : "summary-chip"
                    }
                    onClick={() => commit(year)}
                  >
                    {wholeYearLabel(Number(year.from.slice(0, 4)))}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="summary-meta">
            {summary?.latestFrom && summary.latestTo ? (
              <p>{summaryOpensOn(showing || plainRangeLabel(summary.latestFrom, summary.latestTo))}</p>
            ) : (
              <p />
            )}
            <p>
              {loading && summary ? <span className="summary-updating">{SUMMARY_UPDATING}</span> : null}
              {summary?.currencyLabel ? summaryAmountsNote(summary.currencyLabel) : null}
            </p>
          </div>
        </>
      ) : (
        <div className="summary-meta">
          <p>{SUMMARY_ONE_LEAD}</p>
          <p />
        </div>
      )}

      {error ? (
        <p className="summary-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !summary ? <p className="summary-status">Loading summary…</p> : null}

      {summary && hasRange && !active ? (
        <div className="summary-empty">
          <p>
            {summary.from && summary.to ? summaryEmptyRange(plainRangeLabel(summary.from, summary.to)) : SUMMARY_EMPTY}
          </p>
          <Link className="expenses-go-chat" href="/chat">
            {SUMMARY_GO_CHAT}
          </Link>
        </div>
      ) : null}

      {summary && !hasRange && !loading ? (
        <div className="summary-empty">
          <p>{SUMMARY_EMPTY}</p>
          <Link className="expenses-go-chat" href="/chat">
            {SUMMARY_GO_CHAT}
          </Link>
        </div>
      ) : null}

      {summary && active && currency ? (
        <>
          <section className="summary-cards">
            <article className="summary-card">
              <p className="summary-card-label">Income</p>
              <p className="summary-card-amount is-income">{money(summary.income, currency)}</p>
              <p className="summary-card-delta">{incomeCountLabel(summary.incomeCount)}</p>
            </article>
            <article className="summary-card">
              <p className="summary-card-label">Expenses</p>
              <p className="summary-card-amount is-expense">{money(Math.abs(summary.expenses), currency)}</p>
              <p className="summary-card-delta">{transactionCountLabel(summary.expenseCount)}</p>
            </article>
            <article className="summary-card">
              <p className="summary-card-label">Net</p>
              <p className="summary-card-amount is-net">{signedMoney(summary.net, currency)}</p>
              <p className="summary-card-delta">{SUMMARY_NET_NOTE}</p>
            </article>
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
                    <span className="summary-line-amount is-up">{signedMoney(row.amount, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="summary-line-total">
                <span>Total income</span>
                <span className="summary-line-amount is-up">{signedMoney(summary.income, currency)}</span>
              </p>
            </article>
          </section>

          <section className="summary-panel">
            <h2>Largest expenses</h2>
            <ul className="summary-lines">
              {summary.largest.map((row) => (
                <li key={row.id}>
                  <Link href={`/expenses?focus=${row.id}`}>
                    <p className="summary-line-title">{formatRowDate(row.date)}</p>
                    <p className="summary-line-sub">{expenseDetail(row)}</p>
                  </Link>
                  <span className="summary-line-amount">{money(row.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

function ComparePeriods({
  compare,
  onCompare,
  empty,
}: {
  compare: CompareRanges | null;
  onCompare: (compare: CompareRanges) => void;
  empty: boolean;
}) {
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(compare));
  const [picker, setPicker] = useState<SinglePicker | null>(null);
  const aFrom = compare?.a.from ?? "";
  const aTo = compare?.a.to ?? "";
  const bFrom = compare?.b.from ?? "";
  const bTo = compare?.b.to ?? "";

  useEffect(() => {
    if (!aFrom || !aTo || !bFrom || !bTo) return;
    let ignore = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/summary?${compareSearch({ a: { from: aFrom, to: aTo }, b: { from: bFrom, to: bTo } })}`,
        );
        const body: unknown = await response.json();
        if (ignore) return;
        const parsed = parseCompareSummary(body);
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
  }, [aFrom, aTo, bFrom, bTo]);

  useDismiss(picker !== null, () => setPicker(null));

  function chooseDay(iso: string) {
    if (!picker || !compare) return;
    const which = picker.field.startsWith("a-") ? "a" : "b";
    const field = picker.field.endsWith("from") ? "from" : "to";
    const next = applySingleDate(compare[which], field, iso);
    setPicker(null);
    if (!next) return;
    if (next.from === compare[which].from && next.to === compare[which].to) return;
    onCompare({ ...compare, [which]: next });
  }

  function openField(field: SingleField, month: string) {
    setPicker((current) => (current?.field === field ? null : { field, month }));
  }

  const currency = summary?.currency ?? "";
  const compared = summary ? categoryComparison(summary.categories, summary.compareCategories) : [];

  function field(which: "a" | "b", edge: "from" | "to", align: "start" | "end") {
    const id = `${which}-${edge}` as SingleField;
    const value = compare ? compare[which][edge] : "";
    return (
      <DateField
        kicker={edge === "from" ? "From" : "To"}
        value={value ? formatPlainDate(value) : "—"}
        open={picker?.field === id}
        align={align}
        onClick={() => openField(id, value || compare?.a.from || "")}
        calendar={
          picker?.field === id ? (
            <Calendar
              month={picker.month}
              low={value || null}
              high={value || null}
              hoverRange={false}
              onMonth={(iso) => setPicker({ field: id, month: iso })}
              onPick={chooseDay}
              onClose={() => setPicker(null)}
            />
          ) : null
        }
      />
    );
  }

  return (
    <div aria-busy={loading}>
      <div className="summary-meta">
        <p>{SUMMARY_COMPARE_LEAD}</p>
        <p>{loading && summary ? <span className="summary-updating">{SUMMARY_UPDATING}</span> : null}</p>
      </div>
      {error ? (
        <p className="summary-error" role="alert">
          {error}
        </p>
      ) : null}
      {!compare && empty ? (
        <div className="summary-empty">
          <p>{SUMMARY_EMPTY}</p>
          <Link className="expenses-go-chat" href="/chat">
            {SUMMARY_GO_CHAT}
          </Link>
        </div>
      ) : null}
      {(!compare && !empty) || (loading && !summary) ? <p className="summary-status">Loading summary…</p> : null}
      {summary && compare && currency ? (
        <section className="summary-panel">
          <div className="summary-periods">
            <article className="summary-period">
              <p className="summary-period-label">Period A</p>
              <div className="summary-period-dates">
                {field("a", "from", "start")}
                <span className="summary-arrow" aria-hidden="true">
                  →
                </span>
                {field("a", "to", "start")}
              </div>
              <PeriodStats currency={currency} income={summary.income} expenses={summary.expenses} net={summary.net} />
            </article>
            <article className="summary-period">
              <p className="summary-period-label">Period B</p>
              <div className="summary-period-dates">
                {field("b", "from", "start")}
                <span className="summary-arrow" aria-hidden="true">
                  →
                </span>
                {field("b", "to", "end")}
              </div>
              <PeriodStats
                currency={currency}
                income={summary.compareIncome}
                expenses={summary.compareExpenses}
                net={summary.compareNet}
              />
            </article>
          </div>
          <h2>Period A vs Period B</h2>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="is-num">Period A</th>
                  <th className="is-num">Period B</th>
                  <th className="is-num">{`Change (B ${MINUS} A)`}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="summary-group">
                  <th colSpan={4}>Expenses</th>
                </tr>
                {compared.map((row) => {
                  const change = periodChange(row.periodA, row.periodB, "magnitude");
                  return (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td className="is-num">{money(Math.abs(row.periodA), currency)}</td>
                      <td className="is-num">{money(Math.abs(row.periodB), currency)}</td>
                      <td className={`is-num ${tone(change.amount, "expense")}`}>
                        {formatPeriodChangeText(change, currency)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="summary-total">
                  <td>Total expenses</td>
                  <ChangeCells
                    periodA={summary.expenses}
                    periodB={summary.compareExpenses}
                    basis="magnitude"
                    kind="expense"
                    currency={currency}
                    moneyA={money(Math.abs(summary.expenses), currency)}
                    moneyB={money(Math.abs(summary.compareExpenses), currency)}
                  />
                </tr>
                <tr>
                  <td>Income</td>
                  <ChangeCells
                    periodA={summary.income}
                    periodB={summary.compareIncome}
                    basis="signed"
                    kind="income"
                    currency={currency}
                    moneyA={money(summary.income, currency)}
                    moneyB={money(summary.compareIncome, currency)}
                  />
                </tr>
                <tr className="summary-total">
                  <td>Net</td>
                  <ChangeCells
                    periodA={summary.net}
                    periodB={summary.compareNet}
                    basis="signed"
                    kind="net"
                    currency={currency}
                    moneyA={signedMoney(summary.net, currency)}
                    moneyB={signedMoney(summary.compareNet, currency)}
                  />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="summary-footnote">
            {SUMMARY_COMPARE_LEGEND}
            {summary.currencyLabel ? ` ${summaryAmountsNote(summary.currencyLabel)}` : ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function PeriodStats({
  currency,
  income,
  expenses,
  net,
}: {
  currency: string;
  income: number;
  expenses: number;
  net: number;
}) {
  return (
    <div className="summary-period-stats">
      <article className="summary-card">
        <p className="summary-card-label">Income</p>
        <p className="summary-card-amount is-income">{money(income, currency)}</p>
      </article>
      <article className="summary-card">
        <p className="summary-card-label">Expenses</p>
        <p className="summary-card-amount is-expense">{money(Math.abs(expenses), currency)}</p>
      </article>
      <article className="summary-card">
        <p className="summary-card-label">Net</p>
        <p className={`summary-card-amount ${net < 0 ? "is-down" : "is-net"}`}>{signedMoney(net, currency)}</p>
      </article>
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
    }
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".summary-calendar") || target.closest(".summary-date")) return;
      closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);
}

function DateField({
  kicker,
  value,
  open,
  onClick,
  calendar,
  align = "start",
}: {
  kicker: string;
  value: string;
  open: boolean;
  onClick: () => void;
  calendar: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <span className={align === "end" ? "summary-date-wrap is-align-end" : "summary-date-wrap"}>
      <button type="button" className="summary-date" onClick={onClick} aria-expanded={open} aria-haspopup="dialog">
        <span>{kicker}</span>
        {value}
        <span className="summary-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {calendar}
    </span>
  );
}

function RangeCalendar({
  picker,
  preview,
  onPicker,
  onPick,
  onClose,
}: {
  picker: RangeDraft;
  preview: DateRange | null;
  onPicker: (draft: RangeDraft) => void;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  return (
    <Calendar
      month={picker.month}
      low={preview?.from ?? null}
      high={preview?.to ?? null}
      hoverRange={picker.step === "end"}
      onMonth={(iso) => onPicker({ ...picker, month: iso })}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

function Calendar({
  month,
  low,
  high,
  hoverRange,
  onMonth,
  onPick,
  onClose,
}: {
  month: string;
  low: string | null;
  high: string | null;
  hoverRange: boolean;
  onMonth: (iso: string) => void;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState(low ?? month);
  const range = monthRangeContaining(month);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  if (!range) return null;
  const [year, monthNumber] = range.from.split("-").map(Number);
  const earlier = addDays(range.from, -1);
  const later = addDays(range.to, 1);
  const start = low && high ? (low < high ? low : high) : low;
  const end = low && high ? (low < high ? high : low) : low;
  const rangeEnd = hoverRange && hover ? hover : end;
  const previewLow = start && rangeEnd ? (start < rangeEnd ? start : rangeEnd) : start;
  const previewHigh = start && rangeEnd ? (start < rangeEnd ? rangeEnd : start) : start;

  function move(key: string) {
    const next = moveCalendarDay(cursor, key);
    if (!next) return;
    setCursor(next);
    const nextMonth = monthRangeContaining(next);
    if (nextMonth && nextMonth.from !== range?.from) onMonth(next);
  }

  return (
    <div
      ref={dialogRef}
      className="summary-calendar"
      role="dialog"
      tabIndex={-1}
      aria-label={monthYearLabel(range.from)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onPick(cursor);
          return;
        }
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          move(event.key);
        }
      }}
    >
      <div className="summary-calendar-head">
        <button
          type="button"
          onClick={() => earlier && onMonth(earlier)}
          aria-label={earlier ? monthYearLabel(earlier) : "Earlier"}
        >
          ‹
        </button>
        <strong>{monthYearLabel(range.from)}</strong>
        <button
          type="button"
          onClick={() => later && onMonth(later)}
          aria-label={later ? monthYearLabel(later) : "Later"}
        >
          ›
        </button>
      </div>
      <div className="summary-calendar-grid summary-calendar-week" aria-hidden="true">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="summary-calendar-grid" onMouseLeave={() => setHover(null)}>
        {calendarCells(year, monthNumber).map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const iso = isoDate(year, monthNumber, day);
          const selected = iso === start || iso === rangeEnd;
          const inside = Boolean(previewLow && previewHigh && iso > previewLow && iso < previewHigh);
          const className =
            [selected ? "is-selected" : "", inside ? "is-inside" : "", iso === cursor ? "is-focused" : ""]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <button
              key={iso}
              type="button"
              className={className}
              onClick={() => onPick(iso)}
              onMouseEnter={() => setHover(iso)}
            >
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
