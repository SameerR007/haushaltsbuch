import { ensureMigrated } from "../db";
import { EXPECTED_CATEGORIES } from "../setup/categories";
import type { BankRef, ExistingTxn } from "./types";

export type Household = {
  currency: string;
  categories: string[];
  banks: BankRef[];
  existing: ExistingTxn[];
};

export function loadHousehold(): Household {
  const database = ensureMigrated();
  const preference = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as
    | { currency: string }
    | undefined;
  const categories = (
    database.prepare("SELECT name FROM categories").all() as { name: string }[]
  ).map((row) => row.name);
  const order = new Map<string, number>(EXPECTED_CATEGORIES.map((name, index) => [name, index]));
  categories.sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
  );
  const banks = database
    .prepare("SELECT name, initials FROM banks ORDER BY rowid")
    .all() as BankRef[];
  const existing = database
    .prepare(
      "SELECT id, date, amount, bank, IFNULL(notes, '') AS notes FROM transactions",
    )
    .all() as ExistingTxn[];
  return {
    currency: preference?.currency ?? "EUR",
    categories,
    banks,
    existing,
  };
}
