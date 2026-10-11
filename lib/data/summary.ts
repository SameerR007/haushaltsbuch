import { existsSync } from "node:fs";
import { ensureMigrated, resolveDbPath } from "../db";
import { currencySummaryLabel } from "../setup/chat-logic";
import { parseIsoDate } from "../chat/validate-rows";
import type { SetupResult } from "../setup/types";
import {
  monthRangeContaining,
  previousPeriod,
  roundCents,
} from "./summary-range";
import type { SummaryCategory, SummaryPayload, SummaryRow } from "./summary-types";

export type { SummaryCategory, SummaryPayload, SummaryRow };

export type SummaryQuery = {
  from: string | null;
  to: string | null;
  compareFrom: string | null;
  compareTo: string | null;
};

type Totals = { income: number; expenses: number; net: number };

function emptyPayload(currency: string | null): SummaryPayload {
  return {
    ok: true,
    currency,
    currencyLabel: currency ? currencySummaryLabel(currency) : null,
    from: null,
    to: null,
    compareFrom: null,
    compareTo: null,
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
         COALESCE(SUM(amount), 0) AS net
       FROM transactions
       WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as { income: number; expenses: number; net: number };
  return {
    income: roundCents(row.income),
    expenses: roundCents(row.expenses),
    net: roundCents(row.net),
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

/**
 * Read-only totals for two inclusive date ranges.
 * A positive amount is income, including a refund stored in a spending category.
 * That refund is not subtracted from the category total. Categories sum only negative amounts.
 * Salary and other income are income when they are stored as positive amounts.
 * Removed banks stay in the joins. Nothing is written.
 */
export function loadSummary(query: SummaryQuery): SetupResult<SummaryPayload> {
  if (!existsSync(resolveDbPath())) return emptyPayload(null);

  const latest = latestMonth();
  const currency = readCurrency();
  let from = query.from;
  let to = query.to;
  if (!from && !to) {
    from = latest?.from ?? null;
    to = latest?.to ?? null;
  }
  if (!from || !to) {
    return {
      ...emptyPayload(currency),
      latestFrom: latest?.from ?? null,
      latestTo: latest?.to ?? null,
    };
  }
  if (!parseIsoDate(from) || !parseIsoDate(to) || from > to) {
    return { ok: false, code: "invalid", error: "Choose a start date on or before the end date." };
  }

  let compareFrom = query.compareFrom;
  let compareTo = query.compareTo;
  if (!compareFrom && !compareTo) {
    const previous = previousPeriod(from, to);
    compareFrom = previous?.from ?? null;
    compareTo = previous?.to ?? null;
  }
  if (!compareFrom || !compareTo || !parseIsoDate(compareFrom) || !parseIsoDate(compareTo) || compareFrom > compareTo) {
    return { ok: false, code: "invalid", error: "Choose a start date on or before the end date." };
  }

  const main = totals(from, to);
  const compare = totals(compareFrom, compareTo);
  return {
    ok: true,
    currency,
    currencyLabel: currency ? currencySummaryLabel(currency) : null,
    from,
    to,
    compareFrom,
    compareTo,
    latestFrom: latest?.from ?? null,
    latestTo: latest?.to ?? null,
    income: main.income,
    expenses: main.expenses,
    net: main.net,
    compareIncome: compare.income,
    compareExpenses: compare.expenses,
    compareNet: compare.net,
    categories: categories(from, to),
    compareCategories: categories(compareFrom, compareTo),
    incomeRows: incomeRows(from, to),
    largest: largestExpenses(from, to),
  };
}
