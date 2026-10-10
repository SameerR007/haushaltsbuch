import { randomUUID } from "node:crypto";
import { ensureMigrated } from "../db";
import { parseAmount, parseIsoDate } from "./validate-rows";

export type ConfirmResult =
  | { ok: true; ids: number[]; batchId: string }
  | { ok: false; code: "invalid" | "rejected"; error: string };

export type UndoResult =
  | { ok: true; deletedIds: number[] }
  | { ok: false; code: "invalid" | "rejected"; error: string };

class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

function isSkipped(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { skipped?: unknown }).skipped === true
  );
}

function canonical(input: string, names: Set<string>): string | null {
  for (const name of names) {
    if (name.toLowerCase() === input.toLowerCase()) return name;
  }
  return null;
}

function parseForSave(
  raw: unknown,
  index: number,
  categories: Set<string>,
  banks: Set<string>,
): { date: string; description: string; category: string; bank: string; amount: number } {
  const rowNumber = index + 1;
  if (typeof raw !== "object" || raw === null) {
    throw new SaveError(`Row ${rowNumber} is missing its fields.`);
  }
  const record = raw as Record<string, unknown>;
  const date = typeof record.date === "string" ? parseIsoDate(record.date) : null;
  if (!date) throw new SaveError(`Row ${rowNumber} needs a real date (YYYY-MM-DD).`);
  const amount = parseAmount(record.amount);
  if (amount === null) throw new SaveError(`Row ${rowNumber} needs a numeric amount.`);
  if (typeof record.category !== "string") {
    throw new SaveError(`Row ${rowNumber} needs a category from your list.`);
  }
  const category = canonical(record.category.trim(), categories);
  if (!category) throw new SaveError(`Row ${rowNumber} needs a category from your list.`);
  if (typeof record.bank !== "string") {
    throw new SaveError(`Row ${rowNumber} needs one of your banks.`);
  }
  const bank = canonical(record.bank.trim(), banks);
  if (!bank) throw new SaveError(`Row ${rowNumber} needs one of your banks.`);
  const description =
    typeof record.description === "string" ? record.description.trim().slice(0, 500) : "";
  return { date, description, category, bank, amount };
}

/**
 * Insert a reviewed batch. Category and bank are checked against the tables.
 * The whole batch is one SQLite transaction. Amounts are stored with their sign.
 */
export function confirmTransactions(rawRows: unknown): ConfirmResult {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { ok: false, code: "invalid", error: "Nothing to save." };
  }
  if (rawRows.length > 400) {
    return { ok: false, code: "invalid", error: "That is too many transactions at once." };
  }
  const database = ensureMigrated();
  const batchId = randomUUID();
  try {
    const ids = database.transaction(() => {
      const categories = new Set(
        (database.prepare("SELECT name FROM categories").all() as { name: string }[]).map(
          (row) => row.name,
        ),
      );
      const banks = new Set(
        (database.prepare("SELECT name FROM banks").all() as { name: string }[]).map(
          (row) => row.name,
        ),
      );
      const insert = database.prepare(
        `INSERT INTO transactions (date, category, amount, bank, notes, batch_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const saved: number[] = [];
      for (let index = 0; index < rawRows.length; index += 1) {
        const raw = rawRows[index];
        if (isSkipped(raw)) continue;
        const row = parseForSave(raw, index, categories, banks);
        const info = insert.run(row.date, row.category, row.amount, row.bank, row.description, batchId);
        saved.push(Number(info.lastInsertRowid));
      }
      if (saved.length === 0) throw new SaveError("Nothing to save.");
      return saved;
    })();
    return { ok: true, ids, batchId };
  } catch (error) {
    if (error instanceof SaveError) return { ok: false, code: "invalid", error: error.message };
    return { ok: false, code: "rejected", error: "Could not save those transactions." };
  }
}

const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delete exactly the ids that belong to this batch. Other rows stay. */
export function undoTransactions(rawIds: unknown, rawBatchId: unknown): UndoResult {
  if (typeof rawBatchId !== "string" || !BATCH_ID.test(rawBatchId)) {
    return { ok: false, code: "invalid", error: "That saved batch could not be undone." };
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 400) {
    return { ok: false, code: "invalid", error: "Nothing to undo." };
  }
  const ids: number[] = [];
  for (const raw of rawIds) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      return { ok: false, code: "invalid", error: "That saved batch could not be undone." };
    }
    if (!ids.includes(raw)) ids.push(raw);
  }
  const database = ensureMigrated();
  try {
    const deletedIds = database.transaction(() => {
      const select = database.prepare("SELECT batch_id FROM transactions WHERE id = ?");
      const remove = database.prepare("DELETE FROM transactions WHERE id = ? AND batch_id = ?");
      const deleted: number[] = [];
      for (const id of ids) {
        const row = select.get(id) as { batch_id: string | null } | undefined;
        if (!row) continue;
        if (row.batch_id !== rawBatchId) {
          throw new SaveError("Those rows are not in that saved batch.");
        }
        remove.run(id, rawBatchId);
        deleted.push(id);
      }
      return deleted;
    })();
    return { ok: true, deletedIds };
  } catch (error) {
    if (error instanceof SaveError) return { ok: false, code: "invalid", error: error.message };
    return { ok: false, code: "rejected", error: "Could not undo those transactions." };
  }
}
