/**
 * Runs one already-guarded read query in a separate process so the parent
 * can stop it. A long aggregate does not return to JavaScript; SIGKILL does.
 * stdout is a single JSON object. Do not write anything else.
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

function finish(payload) {
  process.stdout.write(JSON.stringify(payload), () => process.exit(0));
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const sql = typeof input.sql === "string" ? input.sql : "";
  const cap = Number.isInteger(input.cap) ? input.cap : 200;
  const database = new Database(input.dbPath, { readonly: true, fileMustExist: true });
  try {
    database.pragma("query_only = ON");
    const statement = database.prepare(sql);
    if (!statement.reader) {
      finish({ ok: false, error: "Only a single SELECT or WITH query is allowed." });
    } else {
      const columns = statement.columns().map((column) => column.name);
      const rows = [];
      let truncated = false;
      for (const row of statement.iterate()) {
        if (rows.length >= cap) {
          truncated = true;
          break;
        }
        const clean = {};
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === "string") clean[key] = value.slice(0, 1000);
          else if (typeof value === "bigint") clean[key] = Number(value);
          else clean[key] = value === undefined ? null : value;
        }
        rows.push(clean);
      }
      finish({ ok: true, columns, rows, truncated });
    }
  } finally {
    database.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "That query could not be run.";
  finish({ ok: false, error: message.slice(0, 300) });
}
