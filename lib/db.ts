import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { describeCurrency, UNKNOWN_CURRENCY_ERROR } from "./currency";
import { EXPECTED_CATEGORIES } from "./setup/categories";
import { normalizeBank } from "./setup/chat-logic";
import type { SetupResult } from "./setup/types";

const TABLES = ["categories", "banks", "transactions", "preferences"] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS banks (
  name TEXT PRIMARY KEY,
  initials TEXT NOT NULL CHECK (length(initials) BETWEEN 1 AND 4),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories (name),
  amount REAL NOT NULL,
  bank TEXT NOT NULL REFERENCES banks (name),
  notes TEXT,
  batch_id TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (
    length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'
  )
);
`;

let cached: Database.Database | null = null;
let cachedPath: string | null = null;

/** Absolute path of the household file. Callers must not send this to the browser. */
export function resolveDbPath(): string {
  const override = process.env.HAUSHALTSBUCH_DB_PATH?.trim();
  if (override) return resolve(override);
  return join(process.cwd(), "data", "haushaltsbuch.sqlite");
}

/** Basename only. Never a directory. */
export function publicDbName(dbPath = resolveDbPath()): string {
  const base = basename(dbPath);
  if (!base || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
    return "local";
  }
  return base;
}

export function closeDb(): void {
  if (cached) cached.close();
  cached = null;
  cachedPath = null;
}

function openDatabase(): Database.Database {
  const dbPath = resolveDbPath();
  if (cached && cachedPath === dbPath) return cached;
  if (cached) cached.close();
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  ownerOnly(dbPath);
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  cached = database;
  cachedPath = dbPath;
  return database;
}

/**
 * Only this user account may read the money data. SQLite gives the -wal and -shm files the
 * same permissions as the database file. A folder that already exists is left as it is.
 */
function ownerOnly(dbPath: string): void {
  try {
    if (!existsSync(dbPath)) closeSync(openSync(dbPath, "a", 0o600));
    for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  } catch {
    // A file system without Unix permissions (or a read-only copy) still opens.
  }
}

function tableNames(database: Database.Database): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function columnNames(database: Database.Database, table: string): Set<string> {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(columns.map((column) => column.name));
}

function ensureBatchId(database: Database.Database): void {
  if (!columnNames(database, "transactions").has("batch_id")) {
    database.exec("ALTER TABLE transactions ADD COLUMN batch_id TEXT");
  }
}

/**
 * Older files created `banks` with only name and initials.
 * `active` is 1 for a bank the user can still pick. `removed_at` is set when it is hidden.
 * Existing rows stay active. Transactions are not touched.
 */
function ensureBankFlags(database: Database.Database): void {
  const columns = columnNames(database, "banks");
  if (!columns.has("active")) {
    database.exec("ALTER TABLE banks ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.has("removed_at")) {
    database.exec("ALTER TABLE banks ADD COLUMN removed_at TEXT");
  }
}

function migrate(database: Database.Database): void {
  database.exec(SCHEMA);
  ensureBatchId(database);
  ensureBankFlags(database);
  const insertCategory = database.prepare(
    "INSERT INTO categories (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
  );
  const insertPreference = database.prepare(
    "INSERT INTO preferences (id, currency) VALUES (1, 'EUR') ON CONFLICT(id) DO NOTHING",
  );
  const seed = database.transaction(() => {
    for (const name of EXPECTED_CATEGORIES) insertCategory.run(name);
    insertPreference.run();
  });
  seed();
}

export function ensureMigrated(): Database.Database {
  const database = openDatabase();
  migrate(database);
  return database;
}

export function initDatabase(): { ok: true; dbPath: string; tables: string[] } {
  ensureMigrated();
  return { ok: true, dbPath: publicDbName(), tables: [...TABLES] };
}

export type HealthReport = {
  ok: true;
  dbReady: boolean;
  currency: string | null;
  banksCount: number;
};

export function readHealth(): HealthReport {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    return { ok: true, dbReady: false, currency: null, banksCount: 0 };
  }
  try {
    const database = openDatabase();
    const names = tableNames(database);
    const ready = TABLES.every((table) => names.has(table));
    if (!ready) return { ok: true, dbReady: false, currency: null, banksCount: 0 };
    const preference = database
      .prepare("SELECT currency FROM preferences WHERE id = 1")
      .get() as { currency: string } | undefined;
    const bankColumns = columnNames(database, "banks");
    const banks = database
      .prepare(
        bankColumns.has("active")
          ? "SELECT COUNT(*) AS n FROM banks WHERE active = 1"
          : "SELECT COUNT(*) AS n FROM banks",
      )
      .get() as { n: number };
    return {
      ok: true,
      dbReady: true,
      currency: preference?.currency ?? null,
      banksCount: banks.n,
    };
  } catch {
    return { ok: true, dbReady: false, currency: null, banksCount: 0 };
  }
}

export type BankWrite = { name: string; initials: string };

type StoredBank = { name: string; initials: string; active: number };

/**
 * Creates the file if needed, then saves the currency and the submitted banks.
 * A submitted name that matches a stored bank (ignoring case) reactivates that row
 * and updates its initials. It does not insert a second copy.
 * Banks left out of `banks` are deleted when they have no transactions.
 * Banks left out that still have transactions are marked removed. Their rows stay.
 */
export function saveHousehold(input: {
  currency: string;
  banks: BankWrite[];
}): SetupResult {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, code: "invalid", error: "Choose a 3-letter currency code." };
  }
  if (!describeCurrency(currency)) {
    return { ok: false, code: "invalid", error: UNKNOWN_CURRENCY_ERROR };
  }
  if (!Array.isArray(input.banks) || input.banks.length === 0) {
    return { ok: false, code: "invalid", error: "Add at least one bank." };
  }

  const banks = new Map<string, BankWrite>();
  for (const bank of input.banks) {
    if (!bank || typeof bank.name !== "string" || typeof bank.initials !== "string") {
      return {
        ok: false,
        code: "invalid",
        error: "Enter a bank name and initials (1–4 letters).",
      };
    }
    const normalized = normalizeBank(bank.name, bank.initials);
    if (!normalized) {
      return {
        ok: false,
        code: "invalid",
        error: "Enter a bank name and initials (1–4 letters).",
      };
    }
    banks.set(normalized.name, normalized);
  }

  const database = ensureMigrated();
  const preference = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as
    | { currency: string }
    | undefined;
  const savedCount = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  if (savedCount.n > 0 && preference && preference.currency !== currency) {
    return {
      ok: false,
      code: "invalid",
      error: "Amounts already saved are not converted. Set up completely new before choosing another currency.",
    };
  }
  const existing = database
    .prepare("SELECT name, initials, active FROM banks")
    .all() as StoredBank[];
  const upsertPreference = database.prepare(
    `INSERT INTO preferences (id, currency) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET currency = excluded.currency`,
  );
  const reactivate = database.prepare(
    "UPDATE banks SET initials = ?, active = 1, removed_at = NULL WHERE name = ?",
  );
  const insertBank = database.prepare(
    "INSERT INTO banks (name, initials, active, removed_at) VALUES (?, ?, 1, NULL)",
  );
  const transactionCount = database.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE bank = ?",
  );
  const deleteBank = database.prepare("DELETE FROM banks WHERE name = ?");
  const markRemoved = database.prepare(
    "UPDATE banks SET active = 0, removed_at = ? WHERE name = ? AND active = 1",
  );
  const write = database.transaction(() => {
    upsertPreference.run(currency);
    const kept = new Set<string>();
    for (const bank of banks.values()) {
      const matchName =
        existing.find((row) => row.name.toLowerCase() === bank.name.toLowerCase())?.name ??
        [...kept].find((name) => name.toLowerCase() === bank.name.toLowerCase());
      if (matchName) {
        reactivate.run(bank.initials, matchName);
        kept.add(matchName);
      } else {
        insertBank.run(bank.name, bank.initials);
        kept.add(bank.name);
      }
    }
    const removedAt = new Date().toISOString();
    for (const row of existing) {
      if (kept.has(row.name)) continue;
      const count = transactionCount.get(row.name) as { n: number };
      if (count.n === 0) deleteBank.run(row.name);
      else markRemoved.run(removedAt, row.name);
    }
  });
  write();
  return { ok: true };
}

/** Delete every household row and seed categories plus the default euro preference again. */
export function resetHousehold(): void {
  const database = ensureMigrated();
  const wipe = database.transaction(() => {
    database.exec("DELETE FROM transactions");
    database.exec("DELETE FROM banks");
    database.exec("DELETE FROM categories");
    database.exec("DELETE FROM preferences");
  });
  wipe();
  // DELETE leaves the old bytes in free pages and in the WAL. Checkpoint, then
  // rewrite the file so a wiped note is gone from the database and the -wal file.
  database.pragma("wal_checkpoint(TRUNCATE)");
  database.exec("VACUUM");
  migrate(database);
}
