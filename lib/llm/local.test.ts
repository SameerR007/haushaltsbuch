import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { POST as postChat } from "../../app/api/chat/route";
import { POST as postPdf } from "../../app/api/import/pdf/route";
import { LOCAL_IMPORT_SOON } from "../assistant/copy";
import { closeDb } from "../db";
import { runChatTurn } from "./run-turn";

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "haushaltsbuch-local-"));
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

function completion(message: Record<string, unknown>): Response {
  return Response.json({
    id: "chatcmpl-local",
    choices: [{ finish_reason: "tool_calls", message }],
  });
}

test("a local turn turns thinking off, retries one bad tool call, and does not call OpenAI", async () => {
  const urls: string[] = [];
  const bodies: string[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    const body = String(init?.body ?? "");
    bodies.push(body);
    assert.equal(url.includes("api.openai.com"), false);
    assert.match(url, /127\.0\.0\.1:9\/v1\/chat\/completions$/);
    const parsed = JSON.parse(body) as {
      reasoning_effort?: string;
      options?: { num_ctx?: number };
      store?: unknown;
      include?: unknown;
      messages?: { content?: unknown }[];
    };
    assert.equal(parsed.reasoning_effort, "none");
    assert.equal(parsed.options?.num_ctx, 8192);
    assert.equal(parsed.store, undefined);
    assert.equal(parsed.include, undefined);
    assert.equal(JSON.stringify(parsed.messages).includes("earlier question"), true);
    assert.equal(JSON.stringify(parsed.messages).includes("what did I spend"), true);
    calls += 1;
    if (calls === 1) {
      return completion({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_bad", type: "function", function: { name: "run_sql", arguments: "not-json" } }],
      });
    }
    if (calls === 2) {
      return completion({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_ok",
            type: "function",
            function: { name: "run_sql", arguments: JSON.stringify({ query: "SELECT 1" }) },
          },
        ],
      });
    }
    return completion({ role: "assistant", content: "The total is 12.50." });
  };

  let executed = 0;
  const result = await runChatTurn({
    apiKey: "sk-openai-example-key",
    assistant: { type: "local", baseUrl: "http://127.0.0.1:9/v1", model: "qwen3.5:9b" },
    instructions: "You are the bookkeeper.",
    messages: [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "what did I spend" },
    ],
    mode: "chat",
    fetchImpl,
    executeTool: () => {
      executed += 1;
      return { ok: true, rows: [{ total: 12.5 }] };
    },
  });
  assert.equal(executed, 1);
  assert.equal(calls, 3);
  assert.equal(urls.some((url) => url.includes("api.openai.com")), false);
  assert.equal(result.reply, "The total is 12.50.");
  assert.equal(result.reply.includes("sk-openai-example-key"), false);
  assert.equal(bodies.every((body) => body.includes('"reasoning_effort":"none"')), true);
});

test("a second malformed local tool call comes back as ok false", async () => {
  let calls = 0;
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    bodies.push(String(init?.body ?? ""));
    if (calls < 3) {
      return completion({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${calls}`, type: "function", function: { name: "run_sql", arguments: "not-json" } }],
      });
    }
    return completion({ role: "assistant", content: "Stopped." });
  };
  let executed = 0;
  const result = await runChatTurn({
    apiKey: "",
    assistant: { type: "local", baseUrl: "http://127.0.0.1:9/v1", model: "qwen3.5:9b" },
    instructions: "You are the bookkeeper.",
    messages: [{ role: "user", content: "total" }],
    mode: "chat",
    fetchImpl,
    executeTool: () => {
      executed += 1;
      return { ok: true };
    },
  });
  assert.equal(executed, 0);
  assert.equal(calls, 3);
  assert.match(bodies[2] ?? "", /The arguments were not valid JSON/);
  assert.equal(result.reply, "Stopped.");
});

test("chat and PDF routes do not call OpenAI when the assistant is local", async () => {
  await withTempDb(async () => {
    const previousStub = process.env.HAUSHALTSBUCH_STUB_OPENAI;
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];
    process.env.HAUSHALTSBUCH_STUB_OPENAI = "1";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      if (url.includes("api.openai.com")) throw new Error("openai");
      return Response.json({
        choices: [{ message: { role: "assistant", content: "The total is 12.50." } }],
      });
    }) as typeof fetch;
    try {
      const chat = await postChat(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assistant: { type: "local", baseUrl: "http://127.0.0.1:9/v1", model: "qwen3.5:9b" },
            messages: [{ role: "user", content: "what did I spend?" }],
          }),
        }),
      );
      assert.equal(chat.status, 200);
      const form = new FormData();
      form.set("assistant", JSON.stringify({ type: "local", baseUrl: "http://127.0.0.1:9/v1", model: "qwen3.5:9b" }));
      form.set("instruction", "Add the expenses");
      const pdf = await postPdf(new Request("http://localhost/api/import/pdf", { method: "POST", body: form }));
      assert.equal(pdf.status, 400);
      const body = (await pdf.json()) as { error?: string };
      assert.equal(body.error, LOCAL_IMPORT_SOON);
      assert.equal(urls.some((url) => url.includes("api.openai.com")), false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousStub === undefined) delete process.env.HAUSHALTSBUCH_STUB_OPENAI;
      else process.env.HAUSHALTSBUCH_STUB_OPENAI = previousStub;
    }
  });
});
