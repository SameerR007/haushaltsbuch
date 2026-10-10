import { mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
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
  initials TEXT NOT NULL CHECK (length(initials) BETWEEN 1 AND 4)
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
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  cached = database;
  cachedPath = dbPath;
  return database;
}

function tableNames(database: Database.Database): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function ensureBatchId(database: Database.Database): void {
  const columns = database.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "batch_id")) {
    database.exec("ALTER TABLE transactions ADD COLUMN batch_id TEXT");
  }
}

function migrate(database: Database.Database): void {
  database.exec(SCHEMA);
  ensureBatchId(database);
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
    const banks = database.prepare("SELECT COUNT(*) AS n FROM banks").get() as { n: number };
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

/**
 * Creates the file if needed, then upserts the currency and banks.
 * Does not insert transactions or delete banks that are absent from `banks`.
 */
export function saveHousehold(input: {
  currency: string;
  banks: BankWrite[];
}): SetupResult {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, code: "invalid", error: "Choose a 3-letter currency code." };
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
  const upsertPreference = database.prepare(
    `INSERT INTO preferences (id, currency) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET currency = excluded.currency`,
  );
  const upsertBank = database.prepare(
    `INSERT INTO banks (name, initials) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET initials = excluded.initials`,
  );
  const write = database.transaction(() => {
    upsertPreference.run(currency);
    for (const bank of banks.values()) upsertBank.run(bank.name, bank.initials);
  });
  write();
  return { ok: true };
}
