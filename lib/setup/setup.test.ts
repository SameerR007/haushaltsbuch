import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { hasSavedConnection, parseConnection } from "../connection";
import { closeDb, initDatabase, publicDbName, readHealth, resolveDbPath, saveHousehold } from "../db";
import { EXPECTED_CATEGORIES } from "./categories";
import {
  currencyChoiceLabel,
  currencySummaryLabel,
  looksLikeSecret,
  normalizeBank,
  parseCurrencyText,
  suggestInitials,
} from "./chat-logic";
import { validateOpenAiKey } from "./validate-openai";

const OPENAI_KEY = "sk-openai-example-key";

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

function header(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return null;
  const record = headers as Record<string, string>;
  const found = Object.entries(record).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1] ?? null;
}

function withTempDb(fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-"));
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  process.env.HAUSHALTSBUCH_DB_PATH = join(dir, "nested", "household.sqlite");
  closeDb();
  try {
    fn();
  } finally {
    closeDb();
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
    else process.env.HAUSHALTSBUCH_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function openReadonly(): Database.Database {
  closeDb();
  return new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
}

test("default database path stays under data/ and the public name is a basename", () => {
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  delete process.env.HAUSHALTSBUCH_DB_PATH;
  try {
    const dbPath = resolveDbPath();
    assert.equal(dbPath, join(process.cwd(), "data", "haushaltsbuch.sqlite"));
    assert.equal(publicDbName(dbPath), "haushaltsbuch.sqlite");
    assert.equal(isAbsolute(publicDbName(dbPath)), false);
    assert.equal(publicDbName("/tmp/secret-dir/books.sqlite"), "books.sqlite");
    assert.equal(publicDbName(""), "local");
  } finally {
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
    else process.env.HAUSHALTSBUCH_DB_PATH = prev;
  }
});

test("init migrates once, seeds categories, and does not insert money rows", () => {
  withTempDb(() => {
    const before = readHealth();
    assert.deepEqual(before, { ok: true, dbReady: false, currency: null, banksCount: 0 });
    assert.equal(existsSync(resolveDbPath()), false);

    const first = initDatabase();
    assert.equal(first.ok, true);
    assert.equal(first.dbPath, "household.sqlite");
    assert.equal(isAbsolute(first.dbPath), false);
    assert.equal(first.dbPath.includes("nested"), false);
    assert.deepEqual(first.tables, ["categories", "banks", "transactions", "preferences"]);

    const second = initDatabase();
    assert.deepEqual(second, first);

    const database = openReadonly();
    const categories = database
      .prepare("SELECT name FROM categories ORDER BY name")
      .all() as { name: string }[];
    assert.deepEqual(
      categories.map((row) => row.name),
      [...EXPECTED_CATEGORIES].sort(),
    );
    const preference = database.prepare("SELECT id, currency FROM preferences").all() as {
      id: number;
      currency: string;
    }[];
    assert.deepEqual(preference, [{ id: 1, currency: "EUR" }]);
    const transactions = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
      n: number;
    };
    const banks = database.prepare("SELECT COUNT(*) AS n FROM banks").get() as { n: number };
    assert.equal(transactions.n, 0);
    assert.equal(banks.n, 0);
    database.close();

    const health = readHealth();
    assert.deepEqual(health, { ok: true, dbReady: true, currency: "EUR", banksCount: 0 });
  });
});

test("confirm upserts currency and banks and a later init keeps them", () => {
  withTempDb(() => {
    const missing = saveHousehold({ currency: "EUR", banks: [] });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "invalid");

    const bad = saveHousehold({
      currency: "euro",
      banks: [{ name: "ING", initials: "IN" }],
    });
    assert.equal(bad.ok, false);

    const saved = saveHousehold({
      currency: "eur",
      banks: [
        { name: "  ING  ", initials: "in" },
        { name: "ING", initials: "ING" },
      ],
    });
    assert.deepEqual(saved, { ok: true });

    initDatabase();

    const database = openReadonly();
    const preference = database.prepare("SELECT currency FROM preferences WHERE id = 1").get() as {
      currency: string;
    };
    const banks = database.prepare("SELECT name, initials FROM banks ORDER BY name").all();
    const transactions = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
      n: number;
    };
    assert.equal(preference.currency, "EUR");
    assert.deepEqual(banks, [{ name: "ING", initials: "ING" }]);
    assert.equal(transactions.n, 0);
    database.close();

    const updated = saveHousehold({
      currency: "USD",
      banks: [{ name: "N26", initials: "n26" }],
    });
    assert.equal(updated.ok, true);
    const health = readHealth();
    assert.deepEqual(health, { ok: true, dbReady: true, currency: "USD", banksCount: 2 });

    const after = openReadonly();
    const rows = after.prepare("SELECT name, initials FROM banks ORDER BY name").all();
    assert.deepEqual(rows, [
      { name: "ING", initials: "ING" },
      { name: "N26", initials: "N26" },
    ]);
    after.close();
  });
});

test("connection JSON is version 2 and drops cloud fields", () => {
  assert.equal(hasSavedConnection("1"), true);
  assert.equal(hasSavedConnection(""), false);
  assert.equal(parseConnection("1"), null);
  assert.equal(
    parseConnection(
      JSON.stringify({
        v: 1,
        openaiApiKey: OPENAI_KEY,
        currency: "EUR",
        banks: [{ name: "ING", initials: "IN" }],
      }),
    ),
    null,
  );

  const parsed = parseConnection(
    JSON.stringify({
      v: 2,
      openaiApiKey: OPENAI_KEY,
      currency: "EUR",
      banks: [{ name: "ING", initials: "in" }],
      supabaseUrl: "https://abcdefgh.supabase.co",
      anonKey: "eyJexample",
      serviceRoleKey: "secret",
      dbPath: "/tmp/haushaltsbuch.sqlite",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.v, 2);
  assert.equal(parsed.banks[0]?.initials, "IN");
  const stored = JSON.stringify(parsed);
  assert.equal(stored.includes("supabase"), false);
  assert.equal(stored.includes("anonKey"), false);
  assert.equal(stored.includes("serviceRoleKey"), false);
  assert.equal(stored.includes("dbPath"), false);
  assert.equal(stored.includes(OPENAI_KEY), true);
});

test("OpenAI check does not echo the key", async () => {
  let called = "";
  const ok = await validateOpenAiKey(
    { apiKey: OPENAI_KEY },
    mockFetch((url, init) => {
      called = url;
      assert.equal(header(init, "authorization"), `Bearer ${OPENAI_KEY}`);
      return new Response("{}", { status: 200 });
    }),
  );
  assert.equal(ok.ok, true);
  assert.equal(called, "https://api.openai.com/v1/models");

  const rejected = await validateOpenAiKey(
    { apiKey: OPENAI_KEY },
    mockFetch(() => new Response("{}", { status: 401 })),
  );
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(rejected).includes(OPENAI_KEY), false);
  const skipped = await validateOpenAiKey({ apiKey: "nope" }, mockFetch(() => {
    throw new Error("should not fetch");
  }));
  assert.equal(skipped.ok, false);
});

test("chat helpers", () => {
  assert.equal(suggestInitials("ing diba"), "ID");
  assert.equal(suggestInitials("N26"), "N26");
  assert.equal(suggestInitials("Commerzbank"), "COM");
  assert.equal(suggestInitials("a b c d"), "ABC");
  assert.equal(parseCurrencyText("keep euro"), "EUR");
  assert.equal(parseCurrencyText("CHF"), "CHF");
  assert.equal(currencyChoiceLabel("USD"), "USD ($)");
  assert.equal(currencySummaryLabel("EUR"), "euro (€)");
  assert.equal(currencySummaryLabel("GBP"), "GBP (£)");
  assert.equal(currencySummaryLabel("CHF"), "CHF");
  assert.equal(looksLikeSecret("my key sk-abc"), true);
  assert.equal(looksLikeSecret("one bank"), false);
  assert.deepEqual(normalizeBank("  ING  ", "in"), { name: "ING", initials: "IN" });
  assert.equal(normalizeBank("ING", ""), null);
});

test("setup routes are local and the removed cloud routes are gone", () => {
  for (const route of ["init", "openai", "confirm", "health"]) {
    const source = readFileSync(join("app/api/setup", route, "route.ts"), "utf8");
    assert.match(source, /runtime\s*=\s*"nodejs"/);
  }
  for (const gone of ["validate", "create-tables", "sql"]) {
    assert.equal(existsSync(join("app/api/setup", gone, "route.ts")), false);
  }
  assert.equal(existsSync("supabase/setup.sql"), false);
});

test("setup server code does not log and does not mention a cloud database client", () => {
  const roots = ["lib", "app/api/setup", "components/setup"];
  const files = roots.flatMap((dir) => walk(dir));
  assert.ok(files.length > 5);
  for (const file of files) {
    if (file.endsWith("setup.test.ts")) continue;
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("console."), false, file);
    assert.equal(/supabase/i.test(source), false, file);
    assert.equal(source.includes("serviceRole"), false, file);
    assert.equal(source.includes("anonKey"), false, file);
  }
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}
