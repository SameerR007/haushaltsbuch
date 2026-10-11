import { existsSync } from "node:fs";
import { ensureMigrated, resolveDbPath } from "../db";
import { currencySummaryLabel } from "../setup/chat-logic";
import { parseIsoDate } from "../chat/validate-rows";
import type { SetupResult } from "../setup/types";
import { monthRangeContaining, roundCents } from "./summary-range";
import type { CompareSummary, PeriodSummary, SummaryCategory, SummaryRow } from "./summary-types";

export type { CompareSummary, PeriodSummary, SummaryCategory, SummaryRow };

type Totals = {
  income: number;
  expenses: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
};

function currencyFields(currency: string | null): { currency: string | null; currencyLabel: string | null } {
  return {
    currency,
    currencyLabel: currency ? currencySummaryLabel(currency) : null,
  };
}

function emptyPeriod(currency: string | null, latest: { from: string; to: string } | null): PeriodSummary {
  return {
    ok: true,
    scope: "period",
    ...currencyFields(currency),
    from: null,
    to: null,
    latestFrom: latest?.from ?? null,
    latestTo: latest?.to ?? null,
    income: 0,
    expenses: 0,
    net: 0,
    incomeCount: 0,
    expenseCount: 0,
    categories: [],
    incomeRows: [],
    largest: [],
  };
}

function readCurrency(): string | null {
  const database = ensureMigrated();
  const row = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as
    | { currency: string }
    | undefined;
  return row?.currency ?? null;
}

function latestMonth(): { from: string; to: string } | null {
  const database = ensureMigrated();
  const row = database.prepare("SELECT MAX(date) AS date FROM transactions").get() as
    | { date: string | null }
    | undefined;
  if (!row?.date) return null;
  return monthRangeContaining(row.date);
}

function totals(from: string, to: string): Totals {
  const database = ensureMigrated();
  const row = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS expenses,
         COALESCE(SUM(amount), 0) AS net,
         COALESCE(SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END), 0) AS incomeCount,
         COALESCE(SUM(CASE WHEN amount < 0 THEN 1 ELSE 0 END), 0) AS expenseCount
       FROM transactions
       WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as Totals;
  return {
    income: roundCents(row.income),
    expenses: roundCents(row.expenses),
    net: roundCents(row.net),
    incomeCount: row.incomeCount,
    expenseCount: row.expenseCount,
  };
}

function categories(from: string, to: string): SummaryCategory[] {
  const database = ensureMigrated();
  const rows = database
    .prepare(
      `SELECT category, SUM(amount) AS amount
       FROM transactions
       WHERE date >= ? AND date <= ? AND amount < 0
       GROUP BY category
       ORDER BY SUM(amount) ASC, category ASC`,
    )
    .all(from, to) as { category: string; amount: number }[];
  return rows.map((row) => ({ category: row.category, amount: roundCents(row.amount) }));
}

type JoinedRow = {
  id: number;
  date: string;
  category: string;
  bank: string;
  amount: number;
  notes: string | null;
  bank_initials: string | null;
};

function mapRow(row: JoinedRow): SummaryRow {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    bank: row.bank,
    bankInitials: row.bank_initials,
    amount: roundCents(row.amount),
    notes: row.notes,
  };
}

function incomeRows(from: string, to: string): SummaryRow[] {
  const database = ensureMigrated();
  const found = database
    .prepare(
      `SELECT t.id, t.date, t.category, t.bank, t.amount, t.notes, b.initials AS bank_initials
       FROM transactions t
       LEFT JOIN banks b ON b.name = t.bank
       WHERE t.date >= ? AND t.date <= ? AND t.amount > 0
       ORDER BY t.amount DESC, t.date DESC, t.id DESC
       LIMIT 200`,
    )
    .all(from, to) as JoinedRow[];
  return found.map(mapRow);
}

function largestExpenses(from: string, to: string): SummaryRow[] {
  const database = ensureMigrated();
  const found = database
    .prepare(
      `SELECT t.id, t.date, t.category, t.bank, t.amount, t.notes, b.initials AS bank_initials
       FROM transactions t
       LEFT JOIN banks b ON b.name = t.bank
       WHERE t.date >= ? AND t.date <= ? AND t.amount < 0
       ORDER BY t.amount ASC, t.date DESC, t.id DESC
       LIMIT 5`,
    )
    .all(from, to) as JoinedRow[];
  return found.map(mapRow);
}

function invalidRange(from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  return !parseIsoDate(from) || !parseIsoDate(to) || from > to;
}

/**
 * One inclusive range. Income rows, the category donut, and the largest expenses
 * come from this range only. Comparison dates are ignored by the caller.
 * A positive amount is income, including a refund stored in a spending category.
 * Categories sum only negative amounts. Removed banks stay in the joins.
 */
export function loadPeriodSummary(query: { from: string | null; to: string | null }): SetupResult<PeriodSummary> {
  if (!existsSync(resolveDbPath())) return emptyPeriod(null, null);
  const latest = latestMonth();
  const currency = readCurrency();
  let from = query.from;
  let to = query.to;
  if (!from && !to) {
    from = latest?.from ?? null;
    to = latest?.to ?? null;
  }
  if (!from || !to) return emptyPeriod(currency, latest);
  if (invalidRange(from, to)) {
    return { ok: false, code: "invalid", error: "Choose a start date on or before the end date." };
  }
  const main = totals(from, to);
  return {
    ok: true,
    scope: "period",
    ...currencyFields(currency),
    from,
    to,
    latestFrom: latest?.from ?? null,
    latestTo: latest?.to ?? null,
    income: main.income,
    expenses: main.expenses,
    net: main.net,
    incomeCount: main.incomeCount,
    expenseCount: main.expenseCount,
    categories: categories(from, to),
    incomeRows: incomeRows(from, to),
    largest: largestExpenses(from, to),
  };
}

/** Two inclusive ranges for the comparison table. Income rows and largest expenses are not loaded. */
export function loadCompareSummary(query: {
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
}): SetupResult<CompareSummary> {
  if (invalidRange(query.from, query.to) || invalidRange(query.compareFrom, query.compareTo)) {
    return { ok: false, code: "invalid", error: "Choose a start date on or before the end date." };
  }
  if (!existsSync(resolveDbPath())) {
    return {
      ok: true,
      scope: "compare",
      ...currencyFields(null),
      from: query.from,
      to: query.to,
      compareFrom: query.compareFrom,
      compareTo: query.compareTo,
      latestFrom: null,
      latestTo: null,
      income: 0,
      expenses: 0,
      net: 0,
      compareIncome: 0,
      compareExpenses: 0,
      compareNet: 0,
      categories: [],
      compareCategories: [],
    };
  }
  const latest = latestMonth();
  const currency = readCurrency();
  const main = totals(query.from, query.to);
  const compare = totals(query.compareFrom, query.compareTo);
  return {
    ok: true,
    scope: "compare",
    ...currencyFields(currency),
    from: query.from,
    to: query.to,
    compareFrom: query.compareFrom,
    compareTo: query.compareTo,
    latestFrom: latest?.from ?? null,
    latestTo: latest?.to ?? null,
    income: main.income,
    expenses: main.expenses,
    net: main.net,
    compareIncome: compare.income,
    compareExpenses: compare.expenses,
    compareNet: compare.net,
    categories: categories(query.from, query.to),
    compareCategories: categories(query.compareFrom, query.compareTo),
  };
}
