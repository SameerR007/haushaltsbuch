import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { resolveDbPath } from "../db";

export const SQL_ROW_CAP = 200;
export const SQL_TIMEOUT_MS = 1500;

const READ_ERROR = "Only a single SELECT or WITH query is allowed.";

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: string };

function countSqlStatements(sql: string): number {
  let count = 0;
  let current = false;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    if (char === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (char === "'" || char === "\"") {
      const quote = char;
      current = true;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (char === ";") {
      if (current) count += 1;
      current = false;
      i += 1;
      continue;
    }
    if (!/\s/.test(char ?? "")) current = true;
    i += 1;
  }
  if (current) count += 1;
  return count;
}

function startsWithSelectOrWith(sql: string): boolean {
  let rest = sql.trim();
  for (;;) {
    if (rest.startsWith("--")) {
      const newline = rest.indexOf("\n");
      rest = (newline === -1 ? "" : rest.slice(newline + 1)).trim();
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return false;
      rest = rest.slice(end + 2).trim();
      continue;
    }
    break;
  }
  return /^(select|with)\b/i.test(rest);
}

/**
 * Accept a single SELECT or WITH … SELECT.
 * `statement.reader` is the check that the statement returns rows
 * (WITH … INSERT/UPDATE/DELETE is not a reader).
 */
export function guardReadQuery(database: Database.Database, sql: string): QueryResult | { ok: true } {
  const trimmed = sql.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.length > 10_000 || countSqlStatements(trimmed) !== 1) {
    return { ok: false, error: READ_ERROR };
  }
  if (!startsWithSelectOrWith(trimmed)) return { ok: false, error: READ_ERROR };
  try {
    const statement = database.prepare(trimmed);
    if (!statement.reader) return { ok: false, error: READ_ERROR };
  } catch {
    return { ok: false, error: READ_ERROR };
  }
  return { ok: true };
}

function workerPath(): string {
  return join(process.cwd(), "lib", "chat", "sql-worker.mjs");
}

function runQueryProcess(
  dbPath: string,
  sql: string,
  cap: number,
  timeoutMs: number,
): Promise<QueryResult> {
  if (!existsSync(workerPath())) {
    return Promise.resolve({ ok: false, error: "That query could not be run." });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerPath()], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (!child.stdin || !child.stdout) {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "That query could not be run." });
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (result: QueryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, part) => sum + part.length, 0) > 2_000_000) {
        child.kill("SIGKILL");
      }
    });
    child.on("error", () => finish({ ok: false, error: "That query could not be run." }));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        finish({ ok: false, error: "That query took too long." });
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      try {
        const parsed = JSON.parse(text) as QueryResult;
        if (parsed && parsed.ok === true && Array.isArray(parsed.rows) && Array.isArray(parsed.columns)) {
          finish({
            ok: true,
            columns: parsed.columns.map(String),
            rows: parsed.rows.slice(0, cap),
            truncated: Boolean(parsed.truncated) || parsed.rows.length > cap,
          });
          return;
        }
        if (parsed && parsed.ok === false && typeof parsed.error === "string") {
          finish({ ok: false, error: parsed.error });
          return;
        }
      } catch {
        // Fall through to the generic error.
      }
      finish({
        ok: false,
        error: code === 0 ? "That query could not be run." : "That query could not be run.",
      });
    });
    child.stdin.write(JSON.stringify({ dbPath, sql, cap }));
    child.stdin.end();
  });
}

/** Guard the SQL, then run it on a separate read-only connection with a timeout. */
export async function executeReadOnlyQuery(
  sql: string,
  options?: { cap?: number; timeoutMs?: number },
): Promise<QueryResult> {
  const cap = options?.cap ?? SQL_ROW_CAP;
  const timeoutMs = options?.timeoutMs ?? SQL_TIMEOUT_MS;
  const trimmed = sql.replace(/^\uFEFF/, "").trim();
  const dbPath = resolveDbPath();
  let database: Database.Database | null = null;
  try {
    database = new Database(dbPath, { readonly: true, fileMustExist: true });
    database.pragma("query_only = ON");
    const guarded = guardReadQuery(database, trimmed);
    if (!guarded.ok) return guarded;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unable to open|no such file/i.test(message)) {
      return { ok: false, error: "The local database is not ready." };
    }
    return { ok: false, error: "That query could not be run." };
  } finally {
    database?.close();
  }
  return runQueryProcess(dbPath, trimmed, cap, timeoutMs);
}
