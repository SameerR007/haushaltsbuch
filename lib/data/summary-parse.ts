import type { CompareSummary, PeriodSummary, SummaryCategory, SummaryRow } from "./summary-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return undefined;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRow(value: unknown): SummaryRow | null {
  if (!isRecord(value)) return null;
  const amount = num(value.amount);
  if (typeof value.id !== "number" || typeof value.date !== "string" || amount === null) return null;
  if (typeof value.category !== "string" || typeof value.bank !== "string") return null;
  return {
    id: value.id,
    date: value.date,
    category: value.category,
    bank: value.bank,
    bankInitials: typeof value.bankInitials === "string" ? value.bankInitials : null,
    amount,
    notes: typeof value.notes === "string" ? value.notes : null,
  };
}

function parseCategories(value: unknown): SummaryCategory[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SummaryCategory[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.category !== "string") return null;
    const amount = num(entry.amount);
    if (amount === null) return null;
    rows.push({ category: entry.category, amount });
  }
  return rows;
}

function parseRows(value: unknown): SummaryRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SummaryRow[] = [];
  for (const entry of value) {
    const parsed = parseRow(entry);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

export function parsePeriodSummary(value: unknown): PeriodSummary | null {
  if (!isRecord(value) || value.ok !== true || value.scope !== "period") return null;
  const from = dateOrNull(value.from);
  const to = dateOrNull(value.to);
  const latestFrom = dateOrNull(value.latestFrom);
  const latestTo = dateOrNull(value.latestTo);
  const income = num(value.income);
  const expenses = num(value.expenses);
  const net = num(value.net);
  const incomeCount = num(value.incomeCount);
  const expenseCount = num(value.expenseCount);
  const categories = parseCategories(value.categories);
  const incomeRows = parseRows(value.incomeRows);
  const largest = parseRows(value.largest);
  if (
    from === undefined ||
    to === undefined ||
    latestFrom === undefined ||
    latestTo === undefined ||
    income === null ||
    expenses === null ||
    net === null ||
    incomeCount === null ||
    expenseCount === null ||
    !categories ||
    !incomeRows ||
    !largest
  ) {
    return null;
  }
  return {
    ok: true,
    scope: "period",
    currency: typeof value.currency === "string" ? value.currency : null,
    currencyLabel: typeof value.currencyLabel === "string" ? value.currencyLabel : null,
    from,
    to,
    latestFrom,
    latestTo,
    income,
    expenses,
    net,
    incomeCount,
    expenseCount,
    categories,
    incomeRows,
    largest,
  };
}

export function parseCompareSummary(value: unknown): CompareSummary | null {
  if (!isRecord(value) || value.ok !== true || value.scope !== "compare") return null;
  const from = dateOrNull(value.from);
  const to = dateOrNull(value.to);
  const compareFrom = dateOrNull(value.compareFrom);
  const compareTo = dateOrNull(value.compareTo);
  const latestFrom = dateOrNull(value.latestFrom);
  const latestTo = dateOrNull(value.latestTo);
  const income = num(value.income);
  const expenses = num(value.expenses);
  const net = num(value.net);
  const compareIncome = num(value.compareIncome);
  const compareExpenses = num(value.compareExpenses);
  const compareNet = num(value.compareNet);
  const categories = parseCategories(value.categories);
  const compareCategories = parseCategories(value.compareCategories);
  if (
    from === undefined ||
    to === undefined ||
    compareFrom === undefined ||
    compareTo === undefined ||
    latestFrom === undefined ||
    latestTo === undefined ||
    income === null ||
    expenses === null ||
    net === null ||
    compareIncome === null ||
    compareExpenses === null ||
    compareNet === null ||
    !categories ||
    !compareCategories
  ) {
    return null;
  }
  return {
    ok: true,
    scope: "compare",
    currency: typeof value.currency === "string" ? value.currency : null,
    currencyLabel: typeof value.currencyLabel === "string" ? value.currencyLabel : null,
    from,
    to,
    compareFrom,
    compareTo,
    latestFrom,
    latestTo,
    income,
    expenses,
    net,
    compareIncome,
    compareExpenses,
    compareNet,
    categories,
    compareCategories,
  };
}

export function readSummaryError(value: unknown): string {
  if (isRecord(value) && typeof value.error === "string" && value.error) return value.error;
  return "Could not load the summary.";
}
