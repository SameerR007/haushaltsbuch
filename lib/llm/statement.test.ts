import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { POST as postPdf } from "../../app/api/import/pdf/route";
import { FALLBACK_ROW_NOTE, NOTHING_SAVED_TYPE, endpointPdfReadError } from "../assistant/copy";
import { assistantHomeLabel, parseConnection } from "../connection";
import { closeDb } from "../db";
import {
  balanceMismatchText,
  balancePassedText,
  reconcileBalances,
  skippedNote,
} from "../chat/statement";
import type { Household } from "../chat/household";
import { checkImageCapability, describeImageCapability } from "./capabilities";
import { proposeFromPages, readLocalStatement, readStatementPages, type ScanProgress } from "./local-statement";
import { buildStatementPdf } from "./pdf-fixture";
import { extractPageTexts } from "./pdf-text";
import { OpenAiError, runChatTurn } from "./run-turn";

const household: Household = {
  currency: "EUR",
  categories: ["food", "rent", "household", "grocery", "bill", "miscellaneous", "salary"],
  banks: [{ name: "DKB", initials: "DK" }],
  existing: [],
};

const TEXT_PAGE = [
  "Account: Girokonto",
  "01.09.2026 - 30.09.2026",
  "Opening balance: 1820.00",
  "Closing balance: 1407.65",
  "01.09. Gehalt Beispiel GmbH 1950.00",
  "01.09. Miete Musterstrasse 850.00",
].join("\n");

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-statement-"));
  const prev = process.env.HAUSHALTSBUCH_DB_PATH;
  process.env.HAUSHALTSBUCH_DB_PATH = join(dir, "household.sqlite");
  closeDb();
  return fn().finally(() => {
    closeDb();
    if (prev === undefined) delete process.env.HAUSHALTSBUCH_DB_PATH;
    else process.env.HAUSHALTSBUCH_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return "";
}

function toolRows(rows: readonly Record<string, unknown>[]): Response {
  return Response.json({
    id: "chatcmpl-rows",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_rows",
              type: "function",
              function: { name: "propose_transactions", arguments: JSON.stringify({ rows }) },
            },
          ],
        },
      },
    ],
  });
}

function textReply(text: string): Response {
  return Response.json({
    id: "chatcmpl-ocr",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }],
  });
}

const PASS_ROWS = [
  {
    date: "2026-09-01",
    description: "Gehalt Beispiel GmbH",
    category: "salary",
    bank: "DKB",
    amount: 1950,
    uncertain: false,
  },
  {
    date: "2026-09-01",
    description: "Miete Musterstrasse",
    category: "rent",
    bank: "DKB",
    amount: -2362.35,
    uncertain: false,
  },
];

test("a text PDF is read once, includes income, and passes the balance check", async () => {
  const bytes = buildStatementPdf([TEXT_PAGE, "This second page also has plenty of statement text."]);
  const extracted = await extractPageTexts(bytes);
  assert.equal(extracted.length, 2);
  assert.match(extracted[0] ?? "", /Gehalt Beispiel GmbH/);
  assert.match(extracted[0] ?? "", /Opening balance/);

  const urls: string[] = [];
  const bodies: string[] = [];
  const progress: ScanProgress[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = bodyText(init);
    urls.push(url);
    bodies.push(body);
    assert.equal(url.includes("api.openai.com"), false);
    assert.equal(/image\/png|Transcribe this bank statement/.test(body), false);
    return toolRows(PASS_ROWS);
  };
  const result = await readLocalStatement({
    bytes,
    filename: "DKB_Sept_2026.pdf",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    instruction: "Add the transactions from this bank statement",
    messages: [],
    household,
    fetchImpl,
    onProgress: (event) => progress.push(event),
  });
  assert.equal(progress.length, 0);
  assert.equal(result.statement.opening, 1820);
  assert.equal(result.statement.closing, 1407.65);
  assert.equal(result.rows.length, 2);
  const income = result.rows.find((row) => row.description.includes("Gehalt"));
  assert.equal(income?.amount, 1950);
  assert.equal(income?.category, "salary");
  const verdict = reconcileBalances(1820, 1407.65, result.rows);
  assert.equal(verdict.status, "pass");
  if (verdict.status === "pass") {
    assert.equal(
      balancePassedText(verdict, "EUR"),
      "Balance check passed: rows add up to the €-412.35 change from 1,820.00 to 1,407.65.",
    );
  }
  assert.equal(bodies.some((body) => body.includes("propose_transactions")), true);
  assert.equal(urls.every((url) => url.includes("127.0.0.1:11434")), true);
});

test("scanned pages are sent one by one to the OCR model and report progress", async () => {
  const progress: ScanProgress[] = [];
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = bodyText(init);
    seen.push(body);
    if (body.includes("Transcribe this bank statement")) {
      assert.match(body, /glm-ocr/);
      assert.match(body, /image\/png|image_url|"file"/);
      return textReply("15.09. Fitnessstudio Muster 29.90 paid by card");
    }
    return toolRows([
      {
        date: "2026-09-15",
        description: "Fitnessstudio Muster",
        category: "miscellaneous",
        bank: "DKB",
        amount: -29.9,
        uncertain: false,
      },
    ]);
  };
  const result = await readLocalStatement({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "DKB_Sept_2026.pdf",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    instruction: "Add the transactions",
    messages: [],
    household,
    fetchImpl,
    extractTexts: async () => [TEXT_PAGE, ""],
    renderPage: async () => new Uint8Array([1, 2, 3, 4]),
    checkVision: async () => ({ status: "blind" }),
    onProgress: (event) => progress.push(event),
  });
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0], {
    page: 1,
    total: 1,
    model: "glm-ocr",
    textPages: 1,
    scannedPages: 1,
  });
  assert.equal(result.pages[1]?.kind, "ocr");
  assert.equal(result.rows[0]?.description, "Fitnessstudio Muster");
  assert.equal(result.rows[0]?.amount, -29.9);
  assert.equal(seen.filter((body) => body.includes("Transcribe this bank statement")).length, 1);
});

test("with no OCR model, scanned pages are skipped and the chat model is not shown an image", async () => {
  const bodies: string[] = [];
  const result = await readLocalStatement({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "DKB_Sept_2026.pdf",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: null,
    instruction: "Add the transactions",
    messages: [],
    household,
    fetchImpl: async (_input, init) => {
      bodies.push(bodyText(init));
      return toolRows(PASS_ROWS);
    },
    extractTexts: async () => [TEXT_PAGE, ""],
    renderPage: async () => {
      throw new Error("no image");
    },
    checkVision: async () => ({ status: "blind" }),
  });
  assert.deepEqual(result.statement.skippedPages, [2]);
  assert.equal(result.statement.opening, null);
  assert.match(skippedNote(result.statement) ?? "", /Page 2 looks scanned and no OCR model is set/);
  assert.match(skippedNote(result.statement) ?? "", /Change assistant/);
  assert.equal(bodies.some((body) => body.includes("image/png") || body.includes("Transcribe")), false);
  assert.equal(result.rows.length, 2);
});

test("garbled OCR falls back to the chat model and marks that row uncertain", async () => {
  const result = await readLocalStatement({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "DKB_Sept_2026.pdf",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    instruction: "Add the transactions",
    messages: [],
    household,
    fetchImpl: async (_input, init) => {
      const body = bodyText(init);
      if (body.includes("Transcribe this bank statement") && body.includes("glm-ocr")) return textReply("???");
      if (body.includes("Transcribe this bank statement") && body.includes("qwen3.5:9b")) {
        return textReply("18.09. Apotheke am Platz paid 14.00");
      }
      return toolRows([
        {
          date: "2026-09-18",
          description: "Apotheke am Platz",
          category: "miscellaneous",
          bank: "DKB",
          amount: -14,
          uncertain: false,
        },
      ]);
    },
    extractTexts: async () => ["", ""],
    renderPage: async () => new Uint8Array([9, 9, 9]),
    checkVision: async (model) => (model === "qwen3.5:9b" ? { status: "ready" } : { status: "blind" }),
  });
  assert.equal(result.pages[0]?.kind, "fallback");
  assert.equal(result.rows[0]?.note, FALLBACK_ROW_NOTE);
  assert.equal(result.rows[0]?.flags.includes("uncertain"), true);
});

test("an unreadable scanned page stops later pages and offers no balance", async () => {
  let renders = 0;
  const result = await readLocalStatement({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "DKB_Sept_2026.pdf",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    instruction: "Add the transactions",
    messages: [],
    household,
    fetchImpl: async (_input, init) =>
      bodyText(init).includes("Transcribe this bank statement") ? textReply("???") : toolRows(PASS_ROWS),
    extractTexts: async () => [TEXT_PAGE, "", ""],
    renderPage: async () => {
      renders += 1;
      return new Uint8Array([4]);
    },
    checkVision: async () => ({ status: "blind" }),
  });
  assert.equal(renders, 1);
  assert.equal(result.statement.failedPage, 2);
  assert.equal(result.pages[2]?.kind, "unread");
  assert.equal(result.statement.opening, null);
  assert.equal(result.rows.some((row) => row.description.includes("Gehalt")), true);
});

test("reconciliation reports a pass and a mismatch in euros", () => {
  const passed = reconcileBalances(1820, 1407.65, [{ amount: 1950 }, { amount: -2362.35 }]);
  assert.equal(passed.status, "pass");
  if (passed.status === "pass") {
    assert.equal(passed.change, -412.35);
    assert.match(balancePassedText(passed, "EUR"), /€-412\.35 change from 1,820\.00 to 1,407\.65/);
  }
  const failed = reconcileBalances(1820, 1407.65, [{ amount: 1950 }, { amount: -2348.35 }]);
  assert.equal(failed.status, "mismatch");
  if (failed.status === "mismatch") {
    assert.equal(failed.sum, -398.35);
    assert.equal(failed.missing, 14);
    assert.equal(
      balanceMismatchText(failed, "EUR"),
      "These rows add up to €-398.35. The whole statement changed by €-412.35. If you asked for every row, €14.00 is missing: check the amounts below.",
    );
  }
});

test("image capability is a light check and differs for Ollama and LM Studio", async () => {
  async function probe(
    respond: (url: string, body: string) => Response | Promise<Response>,
  ): Promise<{ status: string; command?: string; urls: string[]; bodies: string[] }> {
    const urls: string[] = [];
    const bodies: string[] = [];
    const result = await checkImageCapability({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "glm-ocr",
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = bodyText(init);
        urls.push(url);
        bodies.push(body);
        assert.equal(/image|png|base64/i.test(body), false);
        return respond(url, body);
      },
    });
    return { status: result.status, command: result.status === "missing" ? result.command : undefined, urls, bodies };
  }

  const ready = await probe((url) => {
    assert.match(url, /\/api\/show$/);
    return Response.json({ capabilities: ["completion", "vision"] });
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.urls.length, 1);
  assert.equal(describeImageCapability("glm-ocr", { status: "ready" }).title, "Ready: glm-ocr can read images.");

  const missing = await probe(() => Response.json({ error: "model 'glm-ocr' not found" }, { status: 404 }));
  assert.equal(missing.status, "missing");
  assert.equal(missing.command, "ollama pull glm-ocr");
  assert.equal(missing.urls.length, 1);
  assert.equal(describeImageCapability("glm-ocr", { status: "missing", command: missing.command }).detail, "Run this, then test again:");

  const blind = await probe(() => Response.json({ capabilities: ["completion"] }));
  assert.equal(blind.status, "blind");
  assert.equal(describeImageCapability("glm-ocr", { status: "blind" }).title, "glm-ocr can't read images.");

  const studio = await checkImageCapability({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "google/gemma-3",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/api/show")) return new Response("missing", { status: 404 });
      assert.match(url, /127\.0\.0\.1:1234\/v1\/models$/);
      return Response.json({ data: [{ id: "google/gemma-3", type: "vlm" }] });
    },
  });
  assert.equal(studio.status, "ready");

  const studioBlind = await checkImageCapability({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "qwen3.5:9b",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/api/show")) throw new Error("down");
      return Response.json({ data: [{ id: "qwen3.5:9b", type: "llm" }] });
    },
  });
  assert.equal(studioBlind.status, "blind");

  const studioMissing = await checkImageCapability({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "glm-ocr",
    fetchImpl: async (input) => {
      if (String(input).endsWith("/api/show")) throw new Error("down");
      return Response.json({ data: [{ id: "other-model", type: "vlm" }] });
    },
  });
  assert.deepEqual(studioMissing, { status: "missing" });
});

test("an endpoint PDF rejection stays on that endpoint and names the model", async () => {
  await withTempDb(async () => {
    const previous = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return Response.json({ error: { message: "file not supported", type: "invalid_request_error" } }, { status: 400 });
    }) as typeof fetch;
    try {
      const refused = await runChatTurn({
        apiKey: "",
        assistant: {
          type: "endpoint",
          baseUrl: "https://llm.example-host.net/v1",
          model: "example-model-32b",
          apiKey: "secret-key",
        },
        instructions: "Read the statement.",
        messages: [{ role: "user", content: "Add the transactions" }],
        mode: "pdf",
        pdf: { filename: "DKB.pdf", data: Buffer.from("%PDF-1.4\n") },
        executeTool: () => ({ ok: true }),
      }).then(
        () => null,
        (error: unknown) => error,
      );
      assert.ok(refused instanceof OpenAiError);
      assert.equal(refused.fileRejected, true);
      assert.equal(refused.message, endpointPdfReadError("example-model-32b"));
      assert.equal(urls.some((url) => url.includes("/api/show")), false);
      assert.equal(urls.some((url) => url.includes("api.openai.com")), false);

      const openai = await runChatTurn({
        apiKey: "sk-test-key-12345",
        assistant: { type: "openai", apiKey: "sk-test-key-12345" },
        instructions: "Read the statement.",
        messages: [{ role: "user", content: "Add the transactions" }],
        mode: "pdf",
        pdf: { filename: "DKB.pdf", data: Buffer.from("%PDF-1.4\n") },
        executeTool: () => ({ ok: true }),
      }).then(
        () => null,
        (error: unknown) => error,
      );
      assert.ok(openai instanceof OpenAiError);
      assert.equal(openai.fileRejected, false);
      assert.equal(openai.message.includes("couldn't read the PDF"), false);

      const form = new FormData();
      form.set(
        "assistant",
        JSON.stringify({
          type: "endpoint",
          baseUrl: "https://llm.example-host.net/v1",
          model: "example-model-32b",
          apiKey: "secret-key",
        }),
      );
      form.set("instruction", "Add the transactions from this bank statement");
      form.set("file", new File([buildStatementPdf([TEXT_PAGE])], "DKB_Sept_2026.pdf", { type: "application/pdf" }));
      const response = await postPdf(new Request("http://localhost/api/import/pdf", { method: "POST", body: form }));
      assert.equal(response.status, 422);
      const payload = (await response.json()) as { error?: string; changeAssistant?: boolean; detail?: string };
      assert.equal(payload.error, endpointPdfReadError("example-model-32b"));
      assert.equal(payload.changeAssistant, true);
      assert.equal(payload.detail, NOTHING_SAVED_TYPE);
      assert.equal(urls.some((url) => url.includes("/api/show")), false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test("Import reads pages without the model, and Send picks rows for the note without the model's Uncertain", async () => {
  const calls: string[] = [];
  const pages = await readStatementPages({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    fetchImpl: async (input) => {
      calls.push(String(input));
      return textReply("unused");
    },
    extractTexts: async () => [TEXT_PAGE],
  });
  assert.equal(calls.length, 0);
  assert.equal(pages[0]?.kind, "text");

  const bodies: string[] = [];
  const result = await proposeFromPages({
    pages,
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.5:9b",
    ocrModel: "glm-ocr",
    instruction: "Only the salary",
    messages: [],
    household,
    fetchImpl: async (_input, init) => {
      bodies.push(bodyText(init));
      return toolRows([{ ...PASS_ROWS[0], uncertain: true }]);
    },
  });
  assert.equal(bodies.length, 1);
  assert.match(bodies[0] ?? "", /Only the salary/);
  assert.match(bodies[0] ?? "", /Gehalt Beispiel GmbH/);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.flags.includes("uncertain"), false);
});

test("the read step returns pages, and the propose step takes them back without a file", async () => {
  await withTempDb(async () => {
    const previous = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return toolRows(PASS_ROWS);
    }) as typeof fetch;
    try {
      const assistant = JSON.stringify({ type: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:9b" });
      const read = new FormData();
      read.set("assistant", assistant);
      read.set("step", "read");
      read.set("file", new File([buildStatementPdf([TEXT_PAGE])], "DKB_Sept_2026.pdf", { type: "application/pdf" }));
      const readResponse = await postPdf(new Request("http://localhost/api/import/pdf", { method: "POST", body: read }));
      const readEvent = JSON.parse((await readResponse.text()).trim().split("\n").pop() ?? "{}") as {
        ok?: boolean;
        read?: { pages: { page: number; kind: string; text: string }[] };
      };
      assert.equal(readEvent.ok, true);
      assert.match(readEvent.read?.pages[0]?.text ?? "", /Gehalt Beispiel GmbH/);
      assert.equal(urls.length, 0);

      const propose = new FormData();
      propose.set("assistant", assistant);
      propose.set("step", "propose");
      propose.set("instruction", "Add the expenses");
      propose.set("filename", "DKB_Sept_2026.pdf");
      propose.set("pages", JSON.stringify(readEvent.read?.pages));
      const proposeResponse = await postPdf(new Request("http://localhost/api/import/pdf", { method: "POST", body: propose }));
      const proposeEvent = JSON.parse((await proposeResponse.text()).trim().split("\n").pop() ?? "{}") as {
        ok?: boolean;
        proposal?: { sourceName: string; rows: unknown[] };
      };
      assert.equal(proposeEvent.ok, true);
      assert.equal(proposeEvent.proposal?.sourceName, "DKB_Sept_2026.pdf");
      assert.equal(proposeEvent.proposal?.rows.length, 2);

      const bad = new FormData();
      bad.set("assistant", assistant);
      bad.set("step", "propose");
      bad.set("instruction", "Add the expenses");
      bad.set("pages", JSON.stringify([{ page: 1, kind: "made-up", text: "x" }]));
      const badResponse = await postPdf(new Request("http://localhost/api/import/pdf", { method: "POST", body: bad }));
      assert.equal(badResponse.status, 400);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test("a saved local assistant keeps the OCR model on the home label", () => {
  const withOcr = parseConnection(
    JSON.stringify({
      v: 3,
      currency: "EUR",
      banks: [{ name: "DKB", initials: "DK" }],
      assistant: {
        type: "local",
        address: "http://localhost:11434",
        model: "qwen3.5:9b",
        ocrModel: "glm-ocr",
      },
    }),
  );
  assert.ok(withOcr);
  assert.equal(assistantHomeLabel(withOcr.assistant), "on this computer (qwen3.5:9b) · OCR: glm-ocr");

  const without = parseConnection(
    JSON.stringify({
      v: 3,
      currency: "EUR",
      banks: [{ name: "DKB", initials: "DK" }],
      assistant: { type: "local", address: "http://localhost:11434", model: "qwen3.5:9b" },
    }),
  );
  assert.ok(without);
  assert.equal(assistantHomeLabel(without.assistant), "on this computer (qwen3.5:9b)");

  const ui = readFileSync(new URL("../../components/assistant/assistant-ui.tsx", import.meta.url), "utf8");
  assert.equal(ui.includes("<select"), false);
  assert.match(ui, /id="ocr-model"/);
  // None must not lock the field: typing a model name is how you leave None.
  assert.match(ui, /disabled=\{pending \|\| ocrPending\}\s*data-testid="ocr-model"/);
  assert.match(ui, /disabled=\{pending \|\| ocrPending\}[\s\S]{0,80}data-testid="assistant-continue"/);
  assert.match(ui, /OCR_NONE_NOTE/);
});
