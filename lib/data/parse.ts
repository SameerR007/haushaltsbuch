import type { BankView, HouseholdView, TransactionList, TransactionView } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBank(value: unknown): BankView | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || typeof value.initials !== "string") return null;
  if (typeof value.active !== "boolean") return null;
  if (value.removedAt !== null && typeof value.removedAt !== "string") return null;
  if (typeof value.transactionCount !== "number") return null;
  return {
    name: value.name,
    initials: value.initials,
    active: value.active,
    removedAt: value.removedAt,
    transactionCount: value.transactionCount,
  };
}

export function parseHousehold(value: unknown): HouseholdView | null {
  if (!isRecord(value) || value.ok !== true || value.database !== "on this computer") return null;
  if (value.currency !== null && typeof value.currency !== "string") return null;
  if (value.currencyLabel !== null && typeof value.currencyLabel !== "string") return null;
  if (typeof value.transactionCount !== "number" || !Array.isArray(value.banks)) return null;
  const banks: BankView[] = [];
  for (const bank of value.banks) {
    const parsed = parseBank(bank);
    if (!parsed) return null;
    banks.push(parsed);
  }
  return {
    ok: true,
    database: "on this computer",
    currency: value.currency,
    currencyLabel: typeof value.currencyLabel === "string" ? value.currencyLabel : null,
    transactionCount: value.transactionCount,
    banks,
  };
}

function parseTransaction(value: unknown): TransactionView | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || typeof value.date !== "string") return null;
  if (typeof value.category !== "string" || typeof value.bank !== "string") return null;
  if (typeof value.amount !== "number") return null;
  if (value.notes !== null && typeof value.notes !== "string") return null;
  return {
    id: value.id,
    date: value.date,
    category: value.category,
    bank: value.bank,
    amount: value.amount,
    notes: value.notes,
  };
}

export function parseTransactionList(value: unknown): TransactionList | null {
  if (!isRecord(value) || value.ok !== true) return null;
  if (value.currency !== null && typeof value.currency !== "string") return null;
  if (value.currencyLabel !== null && typeof value.currencyLabel !== "string") return null;
  if (!Array.isArray(value.categories) || !value.categories.every((item) => typeof item === "string")) {
    return null;
  }
  if (!Array.isArray(value.banks) || !Array.isArray(value.transactions)) return null;
  const banks: BankView[] = [];
  for (const bank of value.banks) {
    const parsed = parseBank(bank);
    if (!parsed) return null;
    banks.push(parsed);
  }
  const transactions: TransactionView[] = [];
  for (const row of value.transactions) {
    const parsed = parseTransaction(row);
    if (!parsed) return null;
    transactions.push(parsed);
  }
  return {
    ok: true,
    currency: value.currency,
    currencyLabel: typeof value.currencyLabel === "string" ? value.currencyLabel : null,
    categories: value.categories,
    banks,
    transactions,
  };
}
