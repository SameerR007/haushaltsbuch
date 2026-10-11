import type { SummaryCategory, SummaryPayload, SummaryRow } from "./summary-types";

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

export function parseSummary(value: unknown): SummaryPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
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
    !compareCategories ||
    !Array.isArray(value.incomeRows) ||
    !Array.isArray(value.largest)
  ) {
    return null;
  }
  const incomeRows: SummaryRow[] = [];
  for (const row of value.incomeRows) {
    const parsed = parseRow(row);
    if (!parsed) return null;
    incomeRows.push(parsed);
  }
  const largest: SummaryRow[] = [];
  for (const row of value.largest) {
    const parsed = parseRow(row);
    if (!parsed) return null;
    largest.push(parsed);
  }
  return {
    ok: true,
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
    incomeRows,
    largest,
  };
}

export function readSummaryError(value: unknown): string {
  if (isRecord(value) && typeof value.error === "string" && value.error) return value.error;
  return "Could not load the summary.";
}
