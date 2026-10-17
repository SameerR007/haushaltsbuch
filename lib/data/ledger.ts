import { existsSync } from "node:fs";
import { ensureMigrated, resolveDbPath } from "../db";
import { currencySummaryLabel } from "../setup/chat-logic";
import { EXPECTED_CATEGORIES } from "../setup/categories";
import type { SetupResult } from "../setup/types";
import { parseAmount, parseIsoDate } from "../chat/validate-rows";
import type { BankView, TransactionList, TransactionView } from "./types";
import { readHousehold } from "./banks";

type TxnRow = {
  id: number;
  date: string;
  category: string;
  bank: string;
  amount: number;
  notes: string | null;
};

function sortCategories(names: string[]): string[] {
  const order = new Map<string, number>(EXPECTED_CATEGORIES.map((name, index) => [name, index]));
  return [...names].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
}

function canonical(input: string, names: readonly string[]): string | null {
  return names.find((name) => name.toLowerCase() === input.toLowerCase()) ?? null;
}

export function listTransactions(): TransactionList {
  if (!existsSync(resolveDbPath())) {
    return {
      ok: true,
      currency: null,
      currencyLabel: null,
      categories: [],
      banks: [],
      transactions: [],
    };
  }
  const database = ensureMigrated();
  const household = readHousehold();
  const categories = sortCategories(
    (database.prepare("SELECT name FROM categories").all() as { name: string }[]).map((row) => row.name),
  );
  const transactions = (
    database
      .prepare(
        `SELECT id, date, category, bank, amount, notes
         FROM transactions
         ORDER BY date DESC, id DESC`,
      )
      .all() as TxnRow[]
  ).map((row) => ({
    id: row.id,
    date: row.date,
    category: row.category,
    bank: row.bank,
    amount: row.amount,
    notes: row.notes,
  }));
  return {
    ok: true,
    currency: household.currency,
    currencyLabel: household.currency ? currencySummaryLabel(household.currency) : null,
    categories,
    banks: household.banks,
    transactions,
  };
}

export type TransactionPatch = {
  date?: unknown;
  category?: unknown;
  bank?: unknown;
  amount?: unknown;
  notes?: unknown;
};

function invalid(error: string): SetupResult<{ transaction: TransactionView }> {
  return { ok: false, code: "invalid", error };
}

/**
 * Update one transaction. Only the fields present in `patch` change.
 * `batch_id` is never written. Category must be saved. Bank must be active,
 * or the bank already stored on this row.
 */
export function updateTransaction(
  rawId: unknown,
  patch: TransactionPatch,
): SetupResult<{ transaction: TransactionView }> {
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isInteger(id) || id <= 0) return invalid("That expense isn't in the database.");
  if (!existsSync(resolveDbPath())) return invalid("That expense isn't in the database.");

  const hasDate = Object.prototype.hasOwnProperty.call(patch, "date");
  const hasCategory = Object.prototype.hasOwnProperty.call(patch, "category");
  const hasBank = Object.prototype.hasOwnProperty.call(patch, "bank");
  const hasAmount = Object.prototype.hasOwnProperty.call(patch, "amount");
  const hasNotes = Object.prototype.hasOwnProperty.call(patch, "notes");
  if (!hasDate && !hasCategory && !hasBank && !hasAmount && !hasNotes) {
    return invalid("Nothing to change.");
  }

  const database = ensureMigrated();
  const current = database
    .prepare("SELECT id, date, category, bank, amount, notes, batch_id FROM transactions WHERE id = ?")
    .get(id) as (TxnRow & { batch_id: string | null }) | undefined;
  if (!current) return invalid("That expense isn't in the database.");

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (hasDate) {
    const date = typeof patch.date === "string" ? parseIsoDate(patch.date) : null;
    if (!date) return invalid("Enter a real date (YYYY-MM-DD).");
    sets.push("date = ?");
    params.push(date);
  }
  if (hasAmount) {
    const amount = parseAmount(patch.amount);
    if (amount === null) return invalid("Enter a numeric amount.");
    sets.push("amount = ?");
    params.push(amount);
  }
  if (hasCategory) {
    if (typeof patch.category !== "string") return invalid("Pick a category from your list.");
    const names = (database.prepare("SELECT name FROM categories").all() as { name: string }[]).map(
      (row) => row.name,
    );
    const category = canonical(patch.category.trim(), names);
    if (!category) return invalid("Pick a category from your list.");
    sets.push("category = ?");
    params.push(category);
  }
  if (hasBank) {
    if (typeof patch.bank !== "string") return invalid("Pick one of your banks.");
    const bankInput = patch.bank.trim();
    const banks = database.prepare("SELECT name, active FROM banks").all() as {
      name: string;
      active: number;
    }[];
    const match = banks.find((bank) => bank.name.toLowerCase() === bankInput.toLowerCase());
    if (!match) return invalid("Pick one of your banks.");
    const allowed = match.active === 1 || match.name === current.bank;
    if (!allowed) return invalid("Pick one of your banks.");
    sets.push("bank = ?");
    params.push(match.name);
  }
  if (hasNotes) {
    if (typeof patch.notes !== "string") return invalid("Enter a description.");
    sets.push("notes = ?");
    params.push(patch.notes.trim().slice(0, 500));
  }

  params.push(id);
  database.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const updated = database
    .prepare("SELECT id, date, category, bank, amount, notes FROM transactions WHERE id = ?")
    .get(id) as TxnRow;
  return { ok: true, transaction: updated };
}

/** Delete one transaction for good. Other rows in its batch stay. */
export function deleteTransaction(rawId: unknown): SetupResult<{ id: number }> {
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
  const missing = { ok: false as const, code: "invalid" as const, error: "That expense isn't in the database." };
  if (!Number.isInteger(id) || id <= 0) return missing;
  if (!existsSync(resolveDbPath())) return missing;
  const result = ensureMigrated().prepare("DELETE FROM transactions WHERE id = ?").run(id);
  if (result.changes === 0) return missing;
  return { ok: true, id };
}

export function bankChoicesForRow(banks: readonly BankView[], currentBank: string): BankView[] {
  const active = banks.filter((bank) => bank.active);
  if (active.some((bank) => bank.name === currentBank)) return active;
  const current = banks.find((bank) => bank.name === currentBank);
  return current ? [...active, current] : active;
}
