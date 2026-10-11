import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { excelAmountNumFmt } from "../currency";
import { XLSX_FILENAME, SQLITE_FILENAME } from "./copy";
import { ensureMigrated, resolveDbPath } from "../db";

export { XLSX_FILENAME, SQLITE_FILENAME };

type ExportRow = {
  date: string;
  notes: string | null;
  category: string;
  bank: string;
  amount: number;
};

function transactionRows(): ExportRow[] {
  if (!existsSync(resolveDbPath())) return [];
  const database = ensureMigrated();
  return database
    .prepare(
      `SELECT date, notes, category, bank, amount
       FROM transactions
       ORDER BY date DESC, id DESC`,
    )
    .all() as ExportRow[];
}

function savedCurrency(): string {
  if (!existsSync(resolveDbPath())) return "EUR";
  const database = ensureMigrated();
  const row = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as
    | { currency: string }
    | undefined;
  return row?.currency ?? "EUR";
}

/** Every transaction, including ones whose bank was later removed. Dates stay YYYY-MM-DD. */
export async function buildExpensesWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Haushaltsbuch";
  const sheet = workbook.addWorksheet("Expenses");
  const amountFormat = excelAmountNumFmt(savedCurrency());
  sheet.columns = [
    { header: "Date", key: "date", width: 16 },
    { header: "Description", key: "description", width: 42 },
    { header: "Category", key: "category", width: 18 },
    { header: "Bank", key: "bank", width: 24 },
    { header: "Amount", key: "amount", width: 14 },
  ];
  for (const row of transactionRows()) {
    const added = sheet.addRow({
      date: row.date,
      description: row.notes ?? "",
      category: row.category,
      bank: row.bank,
      amount: row.amount,
    });
    added.getCell("amount").numFmt = amountFormat;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * A consistent snapshot via better-sqlite3 backup.
 * This does not copy the live file while it is open.
 */
export async function backupDatabaseFile(): Promise<Uint8Array | null> {
  if (!existsSync(resolveDbPath())) return null;
  const database = ensureMigrated();
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-backup-"));
  const dest = join(dir, SQLITE_FILENAME);
  try {
    await database.backup(dest);
    return new Uint8Array(readFileSync(dest));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
