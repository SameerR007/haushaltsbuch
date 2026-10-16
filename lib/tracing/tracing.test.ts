import assert from "node:assert/strict";
import test from "node:test";
import { buildStoredChat, parseStoredChat } from "../chat/persist";
import { redactSecrets, traceSessionId, tracingEnabled, withSpan, withTrace } from "./langfuse";

test("tracing is off without both Langfuse keys", () => {
  const before = { pk: process.env.LANGFUSE_PUBLIC_KEY, sk: process.env.LANGFUSE_SECRET_KEY };
  try {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    assert.equal(tracingEnabled(), false);
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-x";
    assert.equal(tracingEnabled(), false);
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-x";
    assert.equal(tracingEnabled(), true);
  } finally {
    if (before.pk === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
    else process.env.LANGFUSE_PUBLIC_KEY = before.pk;
    if (before.sk === undefined) delete process.env.LANGFUSE_SECRET_KEY;
    else process.env.LANGFUSE_SECRET_KEY = before.sk;
  }
});

test("helpers run the callback directly when tracing is off", async () => {
  const value = await withTrace({ name: "chat-turn", input: "x" }, async (root) => {
    root.update({ output: "ignored" });
    return withSpan("sql-guard", "guardrail", { query: "SELECT 1" }, () => 42);
  });
  assert.equal(value, 42);
  await assert.rejects(withTrace({ name: "chat-turn" }, async () => {
    throw new Error("boom");
  }), /boom/);
});

test("the trace mask removes keys anywhere in the data", () => {
  const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
  const masked = redactSecrets({
    prompt: `my key is ${key}`,
    headers: { authorization: "Bearer abc.def-123456789" },
    rows: [{ amount: -12.5, description: "Groceries" }],
  });
  assert.equal(JSON.stringify(masked).includes(key), false);
  assert.equal(JSON.stringify(masked).includes("abc.def-123456789"), false);
  assert.deepEqual((masked as { rows: unknown }).rows, [{ amount: -12.5, description: "Groceries" }]);
});

test("the chat session id is validated and survives storage", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(traceSessionId(id), id);
  assert.equal(traceSessionId("short"), null);
  assert.equal(traceSessionId("has space in it"), null);
  assert.equal(traceSessionId(42), null);

  const items = [{ id: 2, kind: "user" as const, text: "Groceries 12.50" }];
  const stored = buildStoredChat({ promptsUsed: true, items, attachment: null, sessionId: id });
  assert.equal(parseStoredChat(JSON.stringify(stored))?.sessionId, id);
  const without = buildStoredChat({ promptsUsed: true, items, attachment: null });
  assert.equal("sessionId" in without, false);
  assert.equal(parseStoredChat(JSON.stringify({ ...stored, sessionId: "<bad>" }))?.sessionId, undefined);
});
