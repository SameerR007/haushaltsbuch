import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import { POST as postBank } from "../../app/api/banks/route";
import { POST as postRemove } from "../../app/api/banks/remove/route";
import { POST as postRestore } from "../../app/api/banks/restore/route";
import { GET as getSqlite } from "../../app/api/export/sqlite/route";
import { GET as getXlsx } from "../../app/api/export/xlsx/route";
import { GET as getHousehold } from "../../app/api/household/route";
import { POST as postReset } from "../../app/api/setup/reset/route";
import { PATCH as patchTransaction } from "../../app/api/transactions/[id]/route";
import { GET as getTransactions } from "../../app/api/transactions/route";
import { amountKeepingSign } from "../chat/money";
import { parseAmount } from "../chat/validate-rows";
import { confirmTransactions } from "../chat/transactions";
import { loadHousehold } from "../chat/household";
import { CHAT_STORAGE_KEY } from "../chat/persist";
import { PDF_DISCLOSURE_KEY, clearConnection, rememberActiveBanks, writeConnection } from "../connection";
import { SUMMARY_STORAGE_KEY } from "../data/summary-state";
import { closeDb, readHealth, resolveDbPath, saveHousehold } from "../db";
import { EXPECTED_CATEGORIES } from "../setup/categories";
import { isTrackerNavActive, TRACKER_HOME, TRACKER_NAV } from "../../components/tracker/nav";
import {
  excelBackupLabel,
  EXPENSES_EMPTY_ACTION,
  EXPENSES_EMPTY_LEAD,
  EXPENSES_EMPTY_NOTE,
  keptCountLabel,
  removeWarning,
  removedBankLine,
  savedBankLine,
  showExpensesDownload,
  sqliteSavedLine,
  transactionCountLabel,
  xlsxSavedLine,
} from "./copy";

function withTempDb(fn: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-data-"));
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  process.env.HAUSHALTSBUCH_DB_PATH = join(dir, "household.sqlite");
  closeDb();
  const finish = () => {
    closeDb();
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
    else process.env.HAUSHALTSBUCH_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  };
  return Promise.resolve()
    .then(fn)
    .finally(finish);
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json();
  assert.equal(typeof data, "object");
  assert.ok(data);
  return data as Record<string, unknown>;
}

function seed(): void {
  const saved = saveHousehold({
    currency: "EUR",
    banks: [
      { name: "Sparkasse", initials: "SP" },
      { name: "ING", initials: "IN" },
    ],
  });
  assert.equal(saved.ok, true);
}

function expense(amount: number, date: string, description: string, bank = "Sparkasse") {
  return { date, description, category: "grocery", bank, amount };
}

test("date and bank copy", () => {
  assert.equal(transactionCountLabel(0), "no transactions");
  assert.equal(transactionCountLabel(1), "1 transaction");
  assert.equal(transactionCountLabel(128), "128 transactions");
  assert.equal(keptCountLabel(14), "14 transactions kept");
  assert.equal(keptCountLabel(0), "no transactions kept");
  assert.equal(
    removeWarning("Sparkasse", "SP", 14).body,
    "Its 14 transactions stay saved and still show in Expenses and the Excel export. You just won't see it as a choice for new entries.",
  );
  assert.equal(removeWarning("Sparkasse", "SP", 14).title, "Remove Sparkasse (SP)?");
  assert.match(removeWarning("ING", "IN", 0).body, /no transactions/);
  assert.equal(excelBackupLabel(3), "Excel file with all 3 expenses (.xlsx)");
  assert.equal(savedBankLine("N26", "N26"), "Saved N26 (N26). Add another bank?");
  assert.equal(removedBankLine("Sparkasse", "SP"), "Removed Sparkasse (SP). Its transactions stay saved.");
  assert.equal(xlsxSavedLine(142), "haushaltsbuch-expenses.xlsx — 142 expenses");
  assert.equal(sqliteSavedLine(), "haushaltsbuch.sqlite — raw database");
  assert.equal(amountKeepingSign("12.50", -12.5), "-12.5");
  assert.equal(amountKeepingSign("+12.50", -12.5), "+12.50");
  assert.equal(amountKeepingSign("-3", 20), "-3");
  assert.equal(amountKeepingSign("8", 20), "8");
});

test("comma decimals keep the row sign", () => {
  assert.equal(amountKeepingSign("14,25", -12.5), "-14.25");
  assert.equal(parseAmount(amountKeepingSign("14,25", -12.5)), -14.25);
  assert.equal(amountKeepingSign("14,25", 80), "14.25");
  assert.equal(parseAmount(amountKeepingSign("14,25", 80)), 14.25);
  assert.equal(amountKeepingSign("12.50", -4), "-12.5");
  assert.equal(amountKeepingSign("8", 20), "8");
  assert.equal(amountKeepingSign("+14,25", -12.5), "+14.25");
  assert.equal(parseAmount(amountKeepingSign("+14,25", -12.5)), 14.25);
  assert.equal(amountKeepingSign("-3,5", 20), "-3.5");
  assert.equal(parseAmount(amountKeepingSign("-3,5", 20)), -3.5);
  assert.equal(amountKeepingSign("1.234,50", -10), "-1234.5");
  assert.equal(parseAmount(amountKeepingSign("1.234,50", -10)), -1234.5);
  assert.equal(amountKeepingSign("1,234.50", 10), "1234.5");
  assert.equal(parseAmount(amountKeepingSign("1 234,50", -1)), -1234.5);
});

test("tracker nav order, Open tracker, and the empty expenses state", () => {
  assert.deepEqual(
    TRACKER_NAV.map((item) => item.label),
    ["Home", "Expenses", "Chat", "Summary", "Insights ↗"],
  );
  assert.equal(TRACKER_NAV[0]?.href, "/");
  assert.equal(TRACKER_NAV[TRACKER_NAV.length - 1]?.external, true);
  assert.equal(TRACKER_NAV[TRACKER_NAV.length - 1]?.href, "/app/insights");
  assert.equal(TRACKER_HOME, "/app/expenses");
  assert.equal(TRACKER_NAV[1]?.href, TRACKER_HOME);
  const home = TRACKER_NAV[0]!;
  const expenses = TRACKER_NAV[1]!;
  const chat = TRACKER_NAV[2]!;
  assert.equal(isTrackerNavActive("/", home), true);
  assert.equal(isTrackerNavActive("/app", home), false);
  assert.equal(isTrackerNavActive("/app/expenses", home), false);
  assert.equal(isTrackerNavActive("/app/summary", home), false);
  assert.equal(isTrackerNavActive("/app/insights", home), false);
  assert.equal(isTrackerNavActive("/app", chat), true);
  assert.equal(isTrackerNavActive("/app/expenses", chat), false);
  assert.equal(isTrackerNavActive("/app/expenses", expenses), true);
  assert.equal(isTrackerNavActive("/app", expenses), false);
  assert.equal(
    EXPENSES_EMPTY_LEAD,
    "Here you will see all your expenses once you have added some. Go to Chat to add your first expense, or import a bank statement PDF.",
  );
  assert.equal(
    EXPENSES_EMPTY_NOTE,
    "Your expenses stay saved on this computer between openings of the app, unless you choose to set up completely new.",
  );
  assert.equal(EXPENSES_EMPTY_ACTION, "Go to Chat");
  assert.equal(showExpensesDownload(0), false);
  assert.equal(showExpensesDownload(1), true);
  for (const file of ["app/page.tsx", "components/data/your-data.tsx", "components/setup/setup-chat.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("TRACKER_HOME"), true, file);
    assert.equal(source.includes('href="/app"'), false, file);
  }

  const banks = readFileSync("components/data/bank-manager.tsx", "utf8");
  const addAt = banks.indexOf("Add a bank");
  const doneAt = banks.indexOf('className="data-done"');
  assert.ok(addAt > 0 && doneAt > addAt);
  assert.match(banks, /className="data-primary" href=\{changed \? "\/data\?updated=1" : "\/data"\}/);
  assert.match(banks, /Done/);
  assert.match(banks, /removedBankLine/);
  assert.match(banks, /That’s all/);
  assert.match(banks, /href="\/data\?updated=1"/);
  const chrome = readFileSync("components/data/data-chrome.tsx", "utf8");
  assert.match(chrome, /← Back/);
  const yours = readFileSync("components/data/your-data.tsx", "utf8");
  assert.match(yours, /className="data-primary"/);
  assert.match(yours, /Change assistant/);
  assert.match(yours, /Here&apos;s what&apos;s saved/);
  const reset = readFileSync("components/data/start-over.tsx", "utf8");
  assert.match(reset, /Download backup/);
  assert.match(reset, /Back to your data/);
  assert.match(reset, /Keep my data/);
  assert.equal(reset.includes(">Cancel<"), false);
});

test("confirm drops banks that were not submitted", async () => {
  await withTempDb(async () => {
    seed();
    const saved = confirmTransactions([expense(-12.5, "2026-09-12", "Groceries")]);
    assert.equal(saved.ok, true);
    const replaced = saveHousehold({
      currency: "EUR",
      banks: [{ name: "N26", initials: "N26" }],
    });
    assert.equal(replaced.ok, true);

    closeDb();
    const database = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const banks = database.prepare("SELECT name, initials, active FROM banks ORDER BY name").all() as {
      name: string;
      active: number;
      initials: string;
    }[];
    const txns = database.prepare("SELECT bank, notes FROM transactions").all();
    database.close();

    assert.deepEqual(banks, [
      { name: "N26", initials: "N26", active: 1 },
      { name: "Sparkasse", initials: "SP", active: 0 },
    ]);
    assert.deepEqual(txns, [{ bank: "Sparkasse", notes: "Groceries" }]);
    assert.equal(readHealth().banksCount, 1);
    assert.deepEqual(
      loadHousehold().banks.map((bank) => bank.name),
      ["N26"],
    );

    const rejected = confirmTransactions([expense(-1, "2026-09-13", "Again", "Sparkasse")]);
    assert.equal(rejected.ok, false);

    const back = saveHousehold({
      currency: "EUR",
      banks: [
        { name: "sparkasse", initials: "spk" },
        { name: "N26", initials: "N26" },
      ],
    });
    assert.equal(back.ok, true);
    closeDb();
    const after = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const rows = after.prepare("SELECT name, initials, active FROM banks ORDER BY name").all();
    after.close();
    assert.deepEqual(rows, [
      { name: "N26", initials: "N26", active: 1 },
      { name: "Sparkasse", initials: "SPK", active: 1 },
    ]);
  });
});

test("bank routes add, soft-remove, and add back without touching transactions", async () => {
  await withTempDb(async () => {
    seed();
    assert.equal(confirmTransactions([expense(-4, "2026-01-02", "Bread")]).ok, true);

    const added = await postBank(post("http://local/api/banks", { name: "N26", initials: "n26" }));
    assert.equal(added.status, 200);
    const addedBody = await jsonBody(added);
    assert.equal(addedBody.alreadyActive, false);
    assert.equal(addedBody.reactivated, false);
    assert.equal((addedBody.bank as { name: string }).name, "N26");

    const again = await postBank(post("http://local/api/banks", { name: "n26", initials: "ZZ" }));
    const againBody = await jsonBody(again);
    assert.equal(again.status, 200);
    assert.equal(againBody.alreadyActive, true);
    assert.equal((againBody.bank as { initials: string }).initials, "N26");

    const removed = await postRemove(post("http://local/api/banks/remove", { name: "Sparkasse" }));
    assert.equal(removed.status, 200);
    const removedBody = await jsonBody(removed);
    const removedBank = removedBody.bank as { active: boolean; transactionCount: number; name: string };
    assert.equal(removedBank.active, false);
    assert.equal(removedBank.transactionCount, 1);

    closeDb();
    const database = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const count = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    const sparkasse = database.prepare("SELECT initials FROM banks WHERE name = 'Sparkasse'").get() as {
      initials: string;
    };
    database.close();
    assert.equal(count.n, 1);
    assert.equal(sparkasse.initials, "SP");

    const readded = await postBank(post("http://local/api/banks", { name: "Sparkasse", initials: "XX" }));
    const readdedBody = await jsonBody(readded);
    assert.equal(readdedBody.reactivated, true);
    assert.equal((readdedBody.bank as { initials: string }).initials, "XX");
    closeDb();
    const names = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const sparkasseAgain = names.prepare("SELECT COUNT(*) AS n, initials FROM banks WHERE name = 'Sparkasse'").get() as {
      n: number;
      initials: string;
    };
    names.close();
    assert.equal(sparkasseAgain.n, 1);
    assert.equal(sparkasseAgain.initials, "XX");

    const hide = await postRemove(post("http://local/api/banks/remove", { name: "Sparkasse" }));
    assert.equal(hide.status, 200);
    const restored = await postRestore(post("http://local/api/banks/restore", { name: "Sparkasse" }));
    const restoredBody = await jsonBody(restored);
    assert.equal(restored.status, 200);
    assert.equal((restoredBody.bank as { active: boolean }).active, true);

    const missing = await postRemove(post("http://local/api/banks/remove", { name: "Nope" }));
    assert.equal(missing.status, 400);
    const household = await jsonBody(await getHousehold());
    assert.equal(household.database, "on this computer");
    assert.equal(JSON.stringify(household).includes(resolveDbPath()), false);
    const listed = household.banks as { name: string; active: boolean }[];
    assert.equal(listed.some((bank) => bank.name === "ING" && bank.active), true);
    assert.equal(loadHousehold().banks.some((bank) => bank.name === "ING"), true);
  });
});

test("reset requires confirm and recreates defaults", async () => {
  await withTempDb(async () => {
    seed();
    assert.equal(confirmTransactions([expense(-8, "2026-05-01", "Market")]).ok, true);
    const refused = await postReset(post("http://local/api/setup/reset", { confirm: false }));
    assert.equal(refused.status, 400);
    closeDb();
    const before = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const still = before.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    before.close();
    assert.equal(still.n, 1);

    const reset = await postReset(post("http://local/api/setup/reset", { confirm: true }));
    assert.equal(reset.status, 200);
    const health = readHealth();
    assert.equal(health.currency, "EUR");
    assert.equal(health.banksCount, 0);
    closeDb();
    const after = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const transactions = after.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    const banks = after.prepare("SELECT COUNT(*) AS n FROM banks").get() as { n: number };
    const categories = after.prepare("SELECT name FROM categories ORDER BY name").all() as { name: string }[];
    after.close();
    assert.equal(transactions.n, 0);
    assert.equal(banks.n, 0);
    assert.deepEqual(
      categories.map((row) => row.name),
      [...EXPECTED_CATEGORIES].sort(),
    );
  });
});

test("transactions list newest first and patch validates without touching batch_id", async () => {
  await withTempDb(async () => {
    seed();
    const first = confirmTransactions([
      expense(-1, "2026-01-01", "Old"),
      expense(-2, "2026-09-12", "Mid"),
    ]);
    assert.equal(first.ok, true);
    const second = confirmTransactions([expense(-3, "2026-09-12", "New")]);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    const listed = await getTransactions();
    assert.equal(listed.status, 200);
    const body = await jsonBody(listed);
    const rows = body.transactions as { id: number; date: string; notes: string }[];
    assert.deepEqual(
      rows.map((row) => row.id),
      [second.ids[0], first.ids[1], first.ids[0]],
    );
    assert.deepEqual(
      rows.map((row) => row.date),
      ["2026-09-12", "2026-09-12", "2026-01-01"],
    );
    assert.equal(rows[0]?.notes, "New");
    const banks = body.banks as { name: string; active: boolean }[];
    assert.equal(banks.some((bank) => bank.name === "Sparkasse"), true);

    closeDb();
    const before = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const batch = before.prepare("SELECT batch_id FROM transactions WHERE id = ?").get(second.ids[0]) as {
      batch_id: string;
    };
    before.close();

    const id = String(second.ids[0]);
    const patched = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { notes: "Bread", amount: 20 }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(patched.status, 200);
    const patchedBody = await jsonBody(patched);
    const transaction = patchedBody.transaction as { notes: string; amount: number; batch_id?: string };
    assert.equal(transaction.notes, "Bread");
    assert.equal(transaction.amount, 20);
    assert.equal("batch_id" in transaction, false);

    const badCategory = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { category: "nope" }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(badCategory.status, 400);
    const badBank = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { bank: "Nope" }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(badBank.status, 400);
    const badDate = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { date: "2026-02-31" }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(badDate.status, 400);

    await postRemove(post("http://local/api/banks/remove", { name: "ING" }));
    const hidden = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { bank: "ING" }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(hidden.status, 400);
    await postRemove(post("http://local/api/banks/remove", { name: "Sparkasse" }));
    const keepCurrent = await patchTransaction(
      post(`http://local/api/transactions/${id}`, { bank: "Sparkasse", notes: "Still here" }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(keepCurrent.status, 200);

    closeDb();
    const after = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const row = after.prepare("SELECT notes, amount, batch_id, bank FROM transactions WHERE id = ?").get(second.ids[0]) as {
      notes: string;
      amount: number;
      batch_id: string;
      bank: string;
    };
    after.close();
    assert.equal(row.notes, "Still here");
    assert.equal(row.amount, 20);
    assert.equal(row.bank, "Sparkasse");
    assert.equal(row.batch_id, batch.batch_id);
    assert.equal(row.batch_id, second.batchId);
  });
});

test("exports include removed banks and the sqlite file is a backup", async () => {
  await withTempDb(async () => {
    seed();
    assert.equal(confirmTransactions([expense(-12.5, "2026-09-12", "Groceries")]).ok, true);
    assert.equal((await postRemove(post("http://local/api/banks/remove", { name: "Sparkasse" }))).status, 200);

    const xlsx = await getXlsx();
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get("content-disposition") ?? "", /haushaltsbuch-expenses\.xlsx/);
    assert.match(xlsx.headers.get("content-type") ?? "", /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    const xlsxBytes = new Uint8Array(await xlsx.arrayBuffer());
    await workbook.xlsx.load(xlsxBytes as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    assert.deepEqual(header, ["Date", "Description", "Category", "Bank", "Amount"]);
    const values = (sheet.getRow(2).values as unknown[]).slice(1);
    assert.equal(values[0], "2026-09-12");
    assert.equal(values[1], "Groceries");
    assert.equal(values[2], "grocery");
    assert.equal(values[3], "Sparkasse");
    assert.equal(values[4], -12.5);
    assert.match(sheet.getRow(2).getCell(5).numFmt ?? "", /€/);

    const refused = saveHousehold({
      currency: "INR",
      banks: [{ name: "Sparkasse", initials: "SP" }],
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error, /not converted/);
    const stillEur = new ExcelJS.Workbook();
    const stillXlsx = await getXlsx();
    const stillBytes = new Uint8Array(await stillXlsx.arrayBuffer());
    await stillEur.xlsx.load(stillBytes as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    const stillSheet = stillEur.worksheets[0];
    assert.match(stillSheet?.getRow(2).getCell(5).numFmt ?? "", /€/);
    assert.equal((stillSheet?.getRow(2).values as unknown[]).slice(1)[4], -12.5);

    const sqlite = await getSqlite();
    assert.equal(sqlite.status, 200);
    assert.match(sqlite.headers.get("content-disposition") ?? "", /haushaltsbuch\.sqlite/);
    const bytes = Buffer.from(await sqlite.arrayBuffer());
    const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-opened-"));
    const file = join(dir, "opened.sqlite");
    try {
      writeFileSync(file, bytes);
      const opened = new Database(file, { readonly: true, fileMustExist: true });
      const row = opened.prepare("SELECT bank, amount, notes FROM transactions").get() as {
        bank: string;
        amount: number;
        notes: string;
      };
      opened.close();
      assert.deepEqual(row, { bank: "Sparkasse", amount: -12.5, notes: "Groceries" });
      assert.notEqual(file, resolveDbPath());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("browser connection keeps active banks and clears only after reset", () => {
  const store = new Map<string, string>();
  const dataset: { visit?: string } = { visit: "returning" };
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    localStorage: {
      setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
    document: { documentElement: { dataset } },
  });
  try {
    store.set(PDF_DISCLOSURE_KEY, "1");
    writeConnection({
      v: 3,
      assistant: { type: "openai", apiKey: "sk-openai-example-key" },
      currency: "EUR",
      banks: [
        { name: "Sparkasse", initials: "SP" },
        { name: "ING", initials: "IN" },
      ],
    });
    assert.equal(store.has(PDF_DISCLOSURE_KEY), false);
    store.set(PDF_DISCLOSURE_KEY, "1");
    const changed = rememberActiveBanks({
      currency: "EUR",
      banks: [
        { name: "ING", initials: "IN", active: true },
        { name: "Sparkasse", initials: "SP", active: false },
      ],
    });
    assert.equal(changed, true);
    assert.equal(store.has(PDF_DISCLOSURE_KEY), true);
    const stored = JSON.parse(store.get("haushaltsbuch.connection") ?? "{}") as { banks: { name: string }[] };
    assert.deepEqual(stored.banks, [{ name: "ING", initials: "IN" }]);
    store.set(SUMMARY_STORAGE_KEY, "{\"v\":1,\"mode\":\"compare\"}");
    store.set(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        promptsUsed: true,
        items: [{ id: 1, kind: "proposal", phase: "saved", error: "" }],
        attachment: null,
      }),
    );
    clearConnection();
    assert.equal(store.has("haushaltsbuch.connection"), false);
    assert.equal(store.has(PDF_DISCLOSURE_KEY), false);
    assert.equal(store.has(CHAT_STORAGE_KEY), false);
    assert.equal(store.has(SUMMARY_STORAGE_KEY), false);
    assert.equal(dataset.visit, undefined);
  } finally {
    Object.assign(globalThis, { localStorage: previousStorage, document: previousDocument });
  }
});

function transactionCount(): number {
  closeDb();
  const database = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  const row = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  database.close();
  return row.n;
}

function fileHas(path: string, marker: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path).includes(Buffer.from(marker));
}

test("the last active bank cannot be removed", async () => {
  await withTempDb(async () => {
    seed();
    assert.equal((await postRemove(post("http://local/api/banks/remove", { name: "ING" }))).status, 200);
    const last = await postRemove(post("http://local/api/banks/remove", { name: "Sparkasse" }));
    assert.equal(last.status, 400);
    const body = await jsonBody(last);
    assert.equal(body.error, "Keep at least one bank.");
    closeDb();
    const database = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
    const row = database.prepare("SELECT active FROM banks WHERE name = 'Sparkasse'").get() as { active: number };
    database.close();
    assert.equal(row.active, 1);
  });
});

test("reset rejects text/plain and cross-origin posts and still accepts same-origin JSON", async () => {
  await withTempDb(async () => {
    seed();
    assert.equal(confirmTransactions([expense(-8, "2026-05-01", "Market")]).ok, true);
    assert.equal(transactionCount(), 1);

    const plain = await postReset(
      new Request("http://localhost:3000/api/setup/reset", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ confirm: true }),
      }),
    );
    assert.equal(plain.status, 415);
    assert.equal(transactionCount(), 1);

    const crossSite = await postReset(
      new Request("http://localhost:3000/api/setup/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ confirm: true }),
      }),
    );
    assert.equal(crossSite.status, 403);
    assert.equal(transactionCount(), 1);

    const otherOrigin = await postReset(
      new Request("http://localhost:3000/api/setup/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
          origin: "https://evil.example",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ confirm: true }),
      }),
    );
    assert.equal(otherOrigin.status, 403);
    assert.equal(transactionCount(), 1);

    const allowed = await postReset(
      new Request("http://localhost:3000/api/setup/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ confirm: true }),
      }),
    );
    assert.equal(allowed.status, 200);
    assert.equal(transactionCount(), 0);
  });
});

test("reset removes a saved note from the database file and the wal", async () => {
  await withTempDb(async () => {
    seed();
    const marker = "hb-wipe-marker-7c2e91aa-unique-note";
    assert.equal(confirmTransactions([expense(-8, "2026-05-01", marker)]).ok, true);
    closeDb();
    const path = resolveDbPath();
    assert.equal(fileHas(path, marker) || fileHas(`${path}-wal`, marker), true);

    const reset = await postReset(post("http://local/api/setup/reset", { confirm: true }));
    assert.equal(reset.status, 200);
    closeDb();
    assert.equal(fileHas(path, marker), false);
    assert.equal(fileHas(`${path}-wal`, marker), false);
  });
});

test("change keys only updates the key", () => {
  const source = readFileSync("components/setup/setup-chat.tsx", "utf8");
  const start = source.indexOf("async function onSaveKeys");
  assert.ok(start > 0);
  const end = source.indexOf("function renderRich", start);
  const body = source.slice(start, end);
  assert.equal(body.includes("/api/setup/confirm"), false);
  assert.equal(body.includes("/api/setup/openai"), true);
  assert.equal(body.includes("banks: saved.banks"), true);
  assert.equal(source.includes("Set up again"), false);
  assert.equal(source.includes("setUpAgain"), false);
});
