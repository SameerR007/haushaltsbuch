import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { PDF_DISCLOSURE_KEY, writeConnection } from "../connection";
import { closeDb, ensureMigrated, resolveDbPath, saveHousehold } from "../db";
import { POST as postChat } from "../../app/api/chat/route";
import { POST as postPdf } from "../../app/api/import/pdf/route";
import { POST as postConfirm } from "../../app/api/transactions/confirm/route";
import { POST as postUndo } from "../../app/api/transactions/undo/route";
import { confirmLabel, PDF_DISCLOSURE, reviewIntro } from "./copy";
import { formatMoney } from "./money";
import {
  CHAT_MODEL,
  CHAT_REASONING_EFFORT,
  resolveChatModel,
  runChatTurn,
  stubGroceryRow,
  toModelInput,
} from "./openai";
import { attachmentLabel, countPdfPages, formatFileSize } from "./pdf-meta";
import { householdInstructions, previousFullMonth, RUN_SQL_RULE, SIGNED_AMOUNT_RULE, suggestedPrompts, withPdfInstructions } from "./prompts";
import { executeReadOnlyQuery, guardReadQuery, SQL_ROW_CAP } from "./sql-guard";
import { confirmTransactions, undoTransactions } from "./transactions";
import { reviewProposedRows, rowsToSave } from "./validate-rows";

const OPENAI_KEY = "sk-openai-example-key";

function withTempDb(fn: () => void | Promise<void>): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-chat-"));
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  process.env.HAUSHALTSBUCH_DB_PATH = join(dir, "household.sqlite");
  closeDb();
  const finish = () => {
    closeDb();
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
    else process.env.HAUSHALTSBUCH_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(finish);
    }
    finish();
    return;
  } catch (error) {
    finish();
    throw error;
  }
}

function seedBank() {
  const saved = saveHousehold({
    currency: "EUR",
    banks: [{ name: "Sparkasse", initials: "SP" }],
  });
  assert.equal(saved.ok, true);
}

function expense(amount = -12.5, description = "Groceries") {
  return {
    date: "2026-09-12",
    description,
    category: "grocery",
    bank: "Sparkasse",
    amount,
  };
}

function countTransactions(): number {
  closeDb();
  const database = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  const row = database.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  database.close();
  return row.n;
}

function header(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return null;
  const found = Object.entries(headers as Record<string, string>).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1] ?? null;
}

const tinyPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 2/Kids[3 0 R 4 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

test("guard allows one SELECT or WITH and rejects writes", () => {
  const database = new Database(":memory:");
  database.exec("CREATE TABLE t (id INTEGER)");
  const select = database.prepare("SELECT 1");
  const insert = database.prepare("INSERT INTO t (id) VALUES (1)");
  assert.equal(select.reader, true);
  assert.equal(insert.reader, false);
  assert.equal(guardReadQuery(database, "SELECT 1").ok, true);
  assert.equal(guardReadQuery(database, "  -- note\nSELECT 1").ok, true);
  assert.equal(guardReadQuery(database, "SELECT ';'").ok, true);
  assert.equal(guardReadQuery(database, "WITH c AS (SELECT 1 AS n) SELECT n FROM c").ok, true);
  assert.equal(guardReadQuery(database, "INSERT INTO t (id) VALUES (1)").ok, false);
  assert.equal(
    guardReadQuery(database, "WITH c AS (SELECT 1 AS n) INSERT INTO t (id) SELECT n FROM c").ok,
    false,
  );
  assert.equal(database.prepare("WITH c AS (SELECT 1 AS n) INSERT INTO t (id) SELECT n FROM c").reader, false);
  assert.equal(guardReadQuery(database, "SELECT 1; SELECT 2").ok, false);
  assert.equal(guardReadQuery(database, "EXPLAIN SELECT 1").ok, false);
  assert.equal(guardReadQuery(database, "DELETE FROM t").ok, false);
  database.close();
});

test("read-only query caps rows and times out a long scan", async () => {
  await withTempDb(async () => {
    seedBank();
    closeDb();
    const database = new Database(resolveDbPath());
    const insert = database.prepare(
      "INSERT INTO transactions (date, category, amount, bank, notes) VALUES ('2026-01-01', 'food', -1, 'Sparkasse', ?)",
    );
    const write = database.transaction(() => {
      for (let index = 0; index < SQL_ROW_CAP + 40; index += 1) insert.run(String(index));
    });
    write();
    database.close();

    const capped = await executeReadOnlyQuery("SELECT notes FROM transactions ORDER BY notes");
    assert.equal(capped.ok, true);
    if (capped.ok) {
      assert.equal(capped.rows.length, SQL_ROW_CAP);
      assert.equal(capped.truncated, true);
      assert.equal(capped.columns.includes("notes"), true);
    }

    const rejected = await executeReadOnlyQuery("DELETE FROM transactions");
    assert.equal(rejected.ok, false);

    const slow = await executeReadOnlyQuery(
      "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 80000000) SELECT SUM(x) AS n FROM c",
      { timeoutMs: 400 },
    );
    assert.equal(slow.ok, false);
    if (!slow.ok) assert.equal(slow.error, "That query took too long.");
  });
});

test("confirm and undo write one batch and keep signed amounts", () => {
  withTempDb(() => {
    seedBank();
    const saved = confirmTransactions([
      expense(-12.5, "Groceries"),
      {
        date: "2026-09-01",
        description: "Pay",
        category: "salary",
        bank: "Sparkasse",
        amount: 2000,
      },
    ]);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.ids.length, 2);

    closeDb();
    const database = new Database(resolveDbPath(), { readonly: true });
    const rows = database
      .prepare("SELECT category, amount, batch_id FROM transactions ORDER BY amount")
      .all() as { category: string; amount: number; batch_id: string }[];
    assert.equal(rows[0]?.category, "grocery");
    assert.equal(rows[0]?.amount, -12.5);
    assert.equal(rows[1]?.amount, 2000);
    assert.equal(rows.every((row) => row.batch_id === saved.batchId), true);
    const sum = database.prepare("SELECT SUM(amount) AS n FROM transactions").get() as { n: number };
    assert.equal(Math.round(sum.n * 100), 198750);
    database.close();

    const other = confirmTransactions([expense(-3, "Coffee")]);
    assert.equal(other.ok, true);
    if (!other.ok) return;

    const mixed = undoTransactions([saved.ids[0] ?? 1, other.ids[0] ?? 2], other.batchId);
    assert.equal(mixed.ok, false);
    assert.equal(countTransactions(), 3);

    const undone = undoTransactions(saved.ids, saved.batchId);
    assert.equal(undone.ok, true);
    if (undone.ok) assert.deepEqual(undone.deletedIds, saved.ids);
    assert.equal(countTransactions(), 1);

    const again = undoTransactions(saved.ids, saved.batchId);
    assert.equal(again.ok, true);
    if (again.ok) assert.deepEqual(again.deletedIds, []);
    assert.equal(countTransactions(), 1);

    const bad = confirmTransactions([expense(-1, "Ok"), { ...expense(-2, "Nope"), category: "nope" }]);
    assert.equal(bad.ok, false);
    assert.equal(countTransactions(), 1);
  });
});

test("a failing insert rolls the whole batch back", () => {
  withTempDb(() => {
    seedBank();
    closeDb();
    const database = new Database(resolveDbPath());
    database.exec(`
      CREATE TRIGGER abort_second BEFORE INSERT ON transactions
      WHEN (SELECT COUNT(*) FROM transactions) >= 1
      BEGIN
        SELECT RAISE(ABORT, 'stop');
      END;
    `);
    database.close();
    closeDb();
    const result = confirmTransactions([expense(-1, "First"), expense(-2, "Second")]);
    assert.equal(result.ok, false);
    assert.equal(countTransactions(), 0);
  });
});

test("batch_id migration is idempotent and keeps old rows", () => {
  withTempDb(() => {
    const database = new Database(resolveDbPath());
    database.exec(`
      CREATE TABLE categories (name TEXT PRIMARY KEY);
      CREATE TABLE banks (name TEXT PRIMARY KEY, initials TEXT NOT NULL);
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        bank TEXT NOT NULL,
        notes TEXT
      );
      INSERT INTO categories (name) VALUES ('food');
      INSERT INTO banks (name, initials) VALUES ('ING', 'IN');
      INSERT INTO transactions (date, category, amount, bank, notes)
      VALUES ('2026-01-02', 'food', -4, 'ING', 'bread');
    `);
    database.close();
    const migrated = ensureMigrated();
    const columns = migrated.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
    assert.equal(columns.some((column) => column.name === "batch_id"), true);
    const row = migrated.prepare("SELECT notes, batch_id FROM transactions").get() as {
      notes: string;
      batch_id: string | null;
    };
    assert.equal(row.notes, "bread");
    assert.equal(row.batch_id, null);
    ensureMigrated();
    const count = migrated.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    assert.equal(count.n, 1);
  });
});

test("review flags bad fields, defaults one bank, and marks duplicates", () => {
  const banks = [{ name: "Sparkasse", initials: "SP" }];
  const categories = ["grocery", "rent", "salary"];
  const existing = [
    { id: 7, date: "2026-09-12", amount: -12.5, bank: "Sparkasse", notes: "Groceries" },
  ];
  const rows = reviewProposedRows(
    [
      { date: "2026-02-31", description: "Bad", category: "fun", bank: "", amount: "nope", uncertain: true },
      stubGroceryRow(new Date(2026, 9, 10)),
      { date: "2026-09-03", description: "Pay", category: "salary", bank: "Other", amount: 10, uncertain: false },
    ],
    { categories, banks, existing },
  );
  assert.equal(rows[0]?.flags.includes("invalid_date"), true);
  assert.equal(rows[0]?.flags.includes("invalid_amount"), true);
  assert.equal(rows[0]?.flags.includes("unknown_category"), true);
  assert.equal(rows[0]?.flags.includes("uncertain"), true);
  assert.equal(rows[0]?.bank, "Sparkasse");
  assert.equal(rows[1]?.date, "2026-09-12");
  assert.equal(rows[1]?.amount, -12.5);
  assert.equal(rows[1]?.bank, "Sparkasse");
  assert.equal(rows[1]?.flags.includes("duplicate"), true);
  assert.equal(rows[1]?.duplicateOf, 7);
  assert.equal(rows[2]?.amount, 10);
  assert.equal(rows[2]?.flags.includes("uncertain"), true);

  const manyBanks = reviewProposedRows(
    [{ date: "2026-09-12", description: "X", category: "grocery", bank: "", amount: -1, uncertain: false }],
    {
      categories,
      banks: [
        { name: "Sparkasse", initials: "SP" },
        { name: "ING", initials: "IN" },
      ],
      existing: [],
    },
  );
  assert.equal(manyBanks[0]?.flags.includes("unknown_bank"), true);
});

test("confirm skips duplicates unless the client includes them", () => {
  const banks = [{ name: "Sparkasse", initials: "SP" }];
  const categories = ["grocery", "rent"];
  const existing = [
    { id: 7, date: "2026-09-12", amount: -12.5, bank: "Sparkasse", notes: "Groceries" },
  ];
  const reviewed = reviewProposedRows(
    [
      stubGroceryRow(new Date(2026, 9, 10)),
      {
        date: "2026-09-03",
        description: "City Landlord — rent",
        category: "rent",
        bank: "",
        amount: -850,
        uncertain: false,
      },
    ],
    { categories, banks, existing },
  );
  assert.equal(reviewed[0]?.flags.includes("duplicate"), true);
  assert.deepEqual(rowsToSave(reviewed).map((row) => row.description), ["City Landlord — rent"]);
  const included = reviewed.map((row, index) =>
    index === 0 ? { ...row, includeDuplicate: true } : row,
  );
  assert.equal(rowsToSave(included).length, 2);
  const onlyDuplicates = reviewed.filter((row) => row.flags.includes("duplicate"));
  assert.equal(rowsToSave(onlyDuplicates).length, 0);

  withTempDb(() => {
    seedBank();
    const rent = {
      date: "2026-09-03",
      description: "City Landlord — rent",
      category: "rent",
      bank: "Sparkasse",
      amount: -850,
    };
    const skipped = confirmTransactions([{ ...expense(), skipped: true }, rent]);
    assert.equal(skipped.ok, true);
    if (!skipped.ok) return;
    assert.equal(skipped.ids.length, 1);
    assert.equal(countTransactions(), 1);
    closeDb();
    const database = new Database(resolveDbPath(), { readonly: true });
    const notes = database.prepare("SELECT notes FROM transactions").get() as { notes: string };
    database.close();
    assert.equal(notes.notes, "City Landlord — rent");

    const anyway = confirmTransactions([expense()]);
    assert.equal(anyway.ok, true);
    assert.equal(countTransactions(), 2);

    const none = confirmTransactions([
      { ...expense(-1, "A"), skipped: true },
      { ...expense(-2, "B"), skipped: true },
    ]);
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.error, "Nothing to save.");
    assert.equal(countTransactions(), 2);
  });
});

test("run_sql result is sent back on the next request, and the stub uses that path", async () => {
  const prevStub = process.env.HAUSHALTSBUCH_STUB_OPENAI;
  const prevModel = process.env.HAUSHALTSBUCH_CHAT_MODEL;
  delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
  delete process.env.HAUSHALTSBUCH_CHAT_MODEL;
  await withTempDb(async () => {
    seedBank();
    const saved = confirmTransactions([expense(-12.5, "Groceries")]);
    assert.equal(saved.ok, true);

    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = String(init?.body ?? "");
      calls.push(body);
      if (!body.includes("function_call_output")) {
        return Response.json({
          id: "resp_sql",
          output: [
            {
              type: "function_call",
              call_id: "call_sql",
              name: "run_sql",
              arguments: JSON.stringify({
                query: "SELECT amount, notes FROM transactions",
              }),
            },
          ],
        });
      }
      return Response.json({
        id: "resp_done",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Used the query result." }],
          },
        ],
      });
    };

    const live = await runChatTurn({
      apiKey: OPENAI_KEY,
      instructions: "test",
      messages: [{ role: "user", content: "How much is saved?" }],
      mode: "chat",
      fetchImpl,
      executeTool: async (name, args) => {
        assert.equal(name, "run_sql");
        const query =
          typeof args === "object" && args !== null && "query" in args
            ? String((args as { query: unknown }).query)
            : "";
        return executeReadOnlyQuery(query);
      },
    });
    assert.equal(live.reply, "Used the query result.");
    assert.equal(calls.length, 2);
    const second = JSON.parse(calls[1] ?? "{}") as {
      store: boolean;
      previous_response_id?: string;
      input: { type?: string; output?: string; content?: string; role?: string }[];
    };
    assert.equal(second.store, false);
    assert.equal(second.previous_response_id, undefined);
    assert.equal(
      second.input.some((item) => item.role === "user" && item.content === "How much is saved?"),
      true,
    );
    const toolOutput = second.input.find((item) => item.type === "function_call_output");
    assert.equal(typeof toolOutput?.output, "string");
    assert.notEqual(toolOutput?.output, "{}");
    assert.match(toolOutput?.output ?? "", /Groceries/);
    assert.match(toolOutput?.output ?? "", /-12\.5/);

    process.env.HAUSHALTSBUCH_STUB_OPENAI = "1";
    const stubbed = await runChatTurn({
      apiKey: OPENAI_KEY,
      instructions: "test",
      messages: [{ role: "user", content: "How much did I spend?" }],
      mode: "chat",
      executeTool: (name, args) => {
        const query =
          typeof args === "object" && args !== null && "query" in args
            ? String((args as { query: unknown }).query)
            : "";
        return name === "run_sql" ? executeReadOnlyQuery(query) : { ok: false };
      },
    });
    assert.match(stubbed.reply, /-12\.5/);
    assert.equal(stubbed.reply.includes("{}"), false);

    process.env.HAUSHALTSBUCH_CHAT_MODEL = "gpt-5.6-terra";
    assert.equal(resolveChatModel(), "gpt-5.6-terra");
    delete process.env.HAUSHALTSBUCH_CHAT_MODEL;
    assert.equal(resolveChatModel(), CHAT_MODEL);
  });
  if (prevStub === undefined) delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
  else process.env.HAUSHALTSBUCH_STUB_OPENAI = prevStub;
  if (prevModel === undefined) delete process.env.HAUSHALTSBUCH_CHAT_MODEL;
  else process.env.HAUSHALTSBUCH_CHAT_MODEL = prevModel;
});

test("prompts use the previous month, the first bank, and the currency", () => {
  const june = new Date(2026, 5, 18);
  assert.equal(previousFullMonth(june).monthName, "May");
  assert.deepEqual(suggestedPrompts({ bankName: "Sparkasse", currency: "EUR", now: june }), [
    "Add 12.50 groceries from Sparkasse on 12 May",
    "Add the expenses for May from this bank statement",
    "How much did I spend on food in May?",
  ]);
  assert.equal(
    suggestedPrompts({ bankName: "  ", currency: "EUR", now: june })[0],
    "Add 12.50 groceries on 12 May",
  );
  assert.equal(
    suggestedPrompts({ bankName: null, currency: "JPY", now: june })[0],
    "Add 13 groceries on 12 May",
  );
  const october = suggestedPrompts({ bankName: "ING", currency: "EUR", now: new Date(2026, 9, 10) });
  assert.match(october[0], /from ING on 12 September/);
  assert.match(october[2], /in September\?/);
});

test("system prompt requires SQL, signed amounts, and no guessed bank", () => {
  const text = householdInstructions({
    currency: "EUR",
    categories: ["grocery", "salary"],
    banks: [{ name: "ING", initials: "IN" }],
    today: "2026-10-10",
  });
  assert.equal(text.includes(RUN_SQL_RULE), true);
  assert.equal(text.includes(SIGNED_AMOUNT_RULE), true);
  assert.match(text, /Do not use numbers from memory/);
  assert.match(text, /When only one bank is saved, that bank is the default/);
  assert.match(text, /ING \(IN\)/);
  assert.equal(text.includes("€"), false);
  const pdf = withPdfInstructions(text);
  assert.match(pdf, /Answer only by calling propose_transactions/);
  assert.equal(formatMoney(-12.5, "EUR").includes("12.50"), true);
  assert.notEqual(formatMoney(-12.5, "EUR"), formatMoney(-12.5, "USD"));
});

test("pdf chip uses the page tree and a size label", () => {
  const bytes = new TextEncoder().encode(tinyPdf);
  assert.equal(countPdfPages(bytes), 2);
  assert.equal(formatFileSize(84 * 1024), "84 KB");
  assert.equal(attachmentLabel("statement-november.pdf", 2, 84 * 1024), "statement-november.pdf · 2 pages · 84 KB");
});

test("OpenAI request uses the model constant, high reasoning, and detail auto", async () => {
  const calls: { url: string; auth: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, auth: header(init, "authorization") ?? "", body: String(init?.body ?? "") });
    const payload = JSON.parse(String(init?.body)) as { input?: unknown };
    const serialized = JSON.stringify(payload.input ?? null);
    if (!serialized.includes("function_call_output")) {
      return Response.json({
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "propose_transactions",
            arguments: JSON.stringify({ rows: [stubGroceryRow(new Date(2026, 9, 10))] }),
          },
        ],
      });
    }
    return Response.json({
      id: "resp_2",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: `leaked ${OPENAI_KEY}` }],
        },
      ],
    });
  };

  const prev = process.env.HAUSHALTSBUCH_STUB_OPENAI;
  delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
  try {
    const result = await runChatTurn({
      apiKey: OPENAI_KEY,
      instructions: "test",
      messages: [{ role: "user", content: "Add groceries" }],
      mode: "chat",
      fetchImpl,
      executeTool: () => ({ ok: true, saved: false }),
    });
    assert.equal(result.reply.includes(OPENAI_KEY), false);
    assert.equal(result.proposalArgs !== null, true);
    assert.equal(calls.length >= 1, true);
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/responses");
    assert.equal(calls[0]?.auth, `Bearer ${OPENAI_KEY}`);
    const body = JSON.parse(calls[0]?.body ?? "{}") as {
      model: string;
      store: boolean;
      include: string[];
      reasoning: { effort: string };
      previous_response_id?: string;
    };
    assert.equal(body.model, CHAT_MODEL);
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.reasoning.effort, CHAT_REASONING_EFFORT);
    assert.equal(calls[0]?.body.includes(OPENAI_KEY), false);
    assert.equal(calls[0]?.body.includes("previous_response_id"), false);

    calls.length = 0;
    await runChatTurn({
      apiKey: OPENAI_KEY,
      instructions: "test",
      messages: [{ role: "user", content: "Add the expenses" }],
      mode: "pdf",
      pdf: { filename: "statement.pdf", data: Buffer.from(tinyPdf) },
      fetchImpl,
      executeTool: () => ({ ok: true, saved: false }),
    });
    const pdfBody = JSON.parse(calls[0]?.body ?? "{}") as {
      tools: { name: string }[];
      tool_choice: { name: string };
      input: { content: { type: string; detail?: string; file_data?: string }[] }[];
    };
    assert.equal(pdfBody.tool_choice.name, "propose_transactions");
    assert.equal(pdfBody.tools.some((tool) => tool.name === "run_sql"), false);
    const file = pdfBody.input.at(-1)?.content[0];
    assert.equal(file?.type, "input_file");
    assert.equal(file?.detail, "auto");
    assert.equal(file?.file_data?.startsWith("data:application/pdf;base64,"), true);
    const pdfStore = JSON.parse(calls[0]?.body ?? "{}") as { store: boolean };
    assert.equal(pdfStore.store, false);
    assert.equal(JSON.stringify(toModelInput(
      [{ role: "user", content: "Add the expenses" }],
      { filename: "a.pdf", data: Buffer.from("%PDF") },
    )).includes(OPENAI_KEY), false);
  } finally {
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
    else process.env.HAUSHALTSBUCH_STUB_OPENAI = prev;
  }
});

test("chat confirm and undo routes, and a stubbed PDF flags a duplicate", async () => {
  const prevStub = process.env.HAUSHALTSBUCH_STUB_OPENAI;
  const prevDelay = process.env.HAUSHALTSBUCH_STUB_DELAY_MS;
  process.env.HAUSHALTSBUCH_STUB_OPENAI = "1";
  process.env.HAUSHALTSBUCH_STUB_DELAY_MS = "0";
  await withTempDb(async () => {
    seedBank();
    const chat = await postChat(
      new Request("http://local/api/chat", {
        method: "POST",
        body: JSON.stringify({
          apiKey: OPENAI_KEY,
          messages: [{ role: "user", content: "Add 12.50 groceries from Sparkasse on 12 September" }],
        }),
      }),
    );
    const chatBody = (await chat.json()) as {
      ok: boolean;
      proposal: { rows: { amount: number; description: string; bank: string; date: string }[] };
    };
    assert.equal(chatBody.ok, true);
    assert.equal(chatBody.proposal.rows[0]?.amount, -12.5);
    assert.equal(chatBody.proposal.rows[0]?.bank, "Sparkasse");
    assert.equal(countTransactions(), 0);
    assert.equal(JSON.stringify(chatBody).includes(OPENAI_KEY), false);

    const saved = await postConfirm(
      new Request("http://local/api/transactions/confirm", {
        method: "POST",
        body: JSON.stringify({ rows: chatBody.proposal.rows }),
      }),
    );
    const savedBody = (await saved.json()) as { ok: boolean; ids: number[]; batchId: string };
    assert.equal(savedBody.ok, true);
    assert.equal(countTransactions(), 1);

    const form = new FormData();
    form.set("apiKey", OPENAI_KEY);
    form.set("instruction", "Add the expenses for September from this bank statement");
    form.set("file", new File([tinyPdf], "statement-november.pdf", { type: "application/pdf" }));
    const pdf = await postPdf(new Request("http://local/api/import/pdf", { method: "POST", body: form }));
    const pdfBody = (await pdf.json()) as {
      ok: boolean;
      proposal: { sourceName: string; rows: { flags: string[]; description: string }[] };
    };
    assert.equal(pdfBody.ok, true);
    assert.equal(pdfBody.proposal.sourceName, "statement-november.pdf");
    assert.equal(pdfBody.proposal.rows[0]?.flags.includes("duplicate"), true);
    assert.equal(pdfBody.proposal.rows[1]?.description, "City Landlord — rent");
    assert.equal(pdfBody.proposal.rows[1]?.flags.includes("duplicate"), false);
    assert.equal(countTransactions(), 1);

    const undone = await postUndo(
      new Request("http://local/api/transactions/undo", {
        method: "POST",
        body: JSON.stringify({ ids: savedBody.ids, batchId: savedBody.batchId }),
      }),
    );
    const undoneBody = (await undone.json()) as { ok: boolean; deletedIds: number[] };
    assert.equal(undoneBody.ok, true);
    assert.deepEqual(undoneBody.deletedIds, savedBody.ids);
    assert.equal(countTransactions(), 0);

    const tooBig = new Uint8Array(26 * 1024 * 1024);
    tooBig.set([0x25, 0x50, 0x44, 0x46], 0);
    const big = new FormData();
    big.set("apiKey", OPENAI_KEY);
    big.set("instruction", "Add the expenses");
    big.set("file", new File([tooBig], "big.pdf", { type: "application/pdf" }));
    const rejected = await postPdf(new Request("http://local/api/import/pdf", { method: "POST", body: big }));
    const rejectedBody = (await rejected.json()) as { ok: boolean; error: string };
    assert.equal(rejectedBody.ok, false);
    assert.match(rejectedBody.error, /25 MB/);
  });
  if (prevStub === undefined) delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
  else process.env.HAUSHALTSBUCH_STUB_OPENAI = prevStub;
  if (prevDelay === undefined) delete process.env.HAUSHALTSBUCH_STUB_DELAY_MS;
  else process.env.HAUSHALTSBUCH_STUB_DELAY_MS = prevDelay;
});

test("saving setup clears the PDF disclosure", () => {
  const store = new Map<string, string>();
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    localStorage: {
      setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
    document: { documentElement: { dataset: {} as DOMStringMap } },
  });
  try {
    store.set(PDF_DISCLOSURE_KEY, "1");
    writeConnection({
      v: 2,
      openaiApiKey: OPENAI_KEY,
      currency: "EUR",
      banks: [{ name: "ING", initials: "IN" }],
    });
    assert.equal(store.has(PDF_DISCLOSURE_KEY), false);
    assert.equal(store.has("haushaltsbuch.connection"), true);
  } finally {
    Object.assign(globalThis, { localStorage: previousStorage, document: previousDocument });
  }
});

test("copy matches the tracker and example tags are absent", () => {
  assert.equal(PDF_DISCLOSURE, "The whole PDF (text and page images) is sent to OpenAI to read it. Nothing else leaves your computer.");
  assert.equal(reviewIntro(4, "statement-november.pdf"), "I found 4 transactions in statement-november.pdf. Nothing is saved yet — check them first.");
  assert.equal(confirmLabel(1), "Confirm — save 1 transaction");
  const roots = ["lib/chat", "app/api/chat", "app/api/import", "app/api/transactions", "components/tracker", "app/app"];
  const files = roots.flatMap((dir) => walk(dir));
  assert.ok(files.length > 8);
  for (const file of files) {
    if (file.endsWith("chat.test.ts")) continue;
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("console."), false, file);
    assert.equal(/example only/i.test(source), false, file);
    if (!file.endsWith("chat.test.ts")) {
      assert.equal(source.includes("Sparkasse"), false, file);
      assert.equal(source.includes("€"), false, file);
    }
  }
  const modelFile = readFileSync("lib/chat/openai.ts", "utf8");
  assert.equal(modelFile.includes(`"${CHAT_MODEL}"`), true);
  assert.equal(modelFile.split(CHAT_MODEL).length - 1, 1);
  assert.equal(existsSync("docs/chat-api.md"), true);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".mjs") || path.endsWith(".css")
      ? [path]
      : [];
  });
}
