import { ensureMigrated, resolveDbPath } from "../db";
import { currencySummaryLabel, normalizeBank } from "../setup/chat-logic";
import type { SetupResult } from "../setup/types";
import type { BankView, HouseholdView } from "./types";
import { existsSync } from "node:fs";

type BankRow = {
  name: string;
  initials: string;
  active: number;
  removed_at: string | null;
  transaction_count: number;
};

const BANK_SQL = `
  SELECT
    b.name,
    b.initials,
    b.active,
    b.removed_at,
    (SELECT COUNT(*) FROM transactions t WHERE t.bank = b.name) AS transaction_count
  FROM banks b
  ORDER BY b.active DESC, b.rowid
`;

function toView(row: BankRow): BankView {
  return {
    name: row.name,
    initials: row.initials,
    active: row.active === 1,
    removedAt: row.active === 1 ? null : row.removed_at,
    transactionCount: row.transaction_count,
  };
}

function listRows(): BankView[] {
  const database = ensureMigrated();
  return (database.prepare(BANK_SQL).all() as BankRow[]).map(toView);
}

function findBank(name: string): BankView | undefined {
  return listRows().find((bank) => bank.name.toLowerCase() === name.trim().toLowerCase());
}

export function readHousehold(): HouseholdView {
  const empty: HouseholdView = {
    ok: true,
    database: "on this computer",
    currency: null,
    currencyLabel: null,
    transactionCount: 0,
    banks: [],
  };
  if (!existsSync(resolveDbPath())) return empty;
  const database = ensureMigrated();
  const preference = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as
    | { currency: string }
    | undefined;
  const transactions = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  const currency = preference?.currency ?? null;
  return {
    ok: true,
    database: "on this computer",
    currency,
    currencyLabel: currency ? currencySummaryLabel(currency) : null,
    transactionCount: transactions.n,
    banks: listRows(),
  };
}

export type BankWriteResult = SetupResult<{
  bank: BankView;
  alreadyActive: boolean;
  reactivated: boolean;
}>;

/**
 * Add one bank. Other banks are left as they are, including their initials.
 * A removed bank with the same name is activated again instead of inserted twice.
 */
export function addBank(name: unknown, initials: unknown): BankWriteResult {
  if (typeof name !== "string" || typeof initials !== "string") {
    return { ok: false, code: "invalid", error: "Enter a bank name and initials (1–4 letters)." };
  }
  const normalized = normalizeBank(name, initials);
  if (!normalized) {
    return { ok: false, code: "invalid", error: "Enter a bank name and initials (1–4 letters)." };
  }
  const database = ensureMigrated();
  const current = findBank(normalized.name);
  if (current?.active) {
    return { ok: true, bank: current, alreadyActive: true, reactivated: false };
  }
  if (current) {
    database.prepare("UPDATE banks SET active = 1, removed_at = NULL WHERE name = ?").run(current.name);
    const bank = findBank(current.name);
    if (!bank) {
      return { ok: false, code: "rejected", error: "Could not add that bank." };
    }
    return { ok: true, bank, alreadyActive: false, reactivated: true };
  }
  database
    .prepare("INSERT INTO banks (name, initials, active, removed_at) VALUES (?, ?, 1, NULL)")
    .run(normalized.name, normalized.initials);
  const bank = findBank(normalized.name);
  if (!bank) return { ok: false, code: "rejected", error: "Could not add that bank." };
  return { ok: true, bank, alreadyActive: false, reactivated: false };
}

/** Hide a bank from new entries. Its transactions stay linked to it. */
export function removeBank(name: unknown): SetupResult<{ bank: BankView }> {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, code: "invalid", error: "That bank isn't in your list." };
  }
  const current = existsSync(resolveDbPath()) ? findBank(name) : undefined;
  if (!current) return { ok: false, code: "invalid", error: "That bank isn't in your list." };
  if (!current.active) return { ok: true, bank: current };
  const database = ensureMigrated();
  database
    .prepare("UPDATE banks SET active = 0, removed_at = ? WHERE name = ?")
    .run(new Date().toISOString(), current.name);
  const bank = findBank(current.name);
  if (!bank) return { ok: false, code: "rejected", error: "Could not remove that bank." };
  return { ok: true, bank };
}

/** Show a removed bank as a choice for new entries again. */
export function restoreBank(name: unknown): SetupResult<{ bank: BankView }> {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, code: "invalid", error: "That bank isn't in your list." };
  }
  const current = existsSync(resolveDbPath()) ? findBank(name) : undefined;
  if (!current) return { ok: false, code: "invalid", error: "That bank isn't in your list." };
  if (current.active) return { ok: true, bank: current };
  const database = ensureMigrated();
  database.prepare("UPDATE banks SET active = 1, removed_at = NULL WHERE name = ?").run(current.name);
  const bank = findBank(current.name);
  if (!bank) return { ok: false, code: "rejected", error: "Could not add that bank back." };
  return { ok: true, bank };
}
