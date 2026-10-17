import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POST as postAssistant } from "../../app/api/setup/assistant/route";
import { probeAssistant } from "./probe";
import { endpointWarning, localModelWarning } from "./target";
import { extraHostNames, hostAllowed } from "../local-host";
import { clearConnection, parseConnection, writeConnection } from "../connection";

const OPENAI_KEY = "sk-openai-example-key";

test("a saved OpenAI connection with no assistant type stays on OpenAI", () => {
  const parsed = parseConnection(
    JSON.stringify({
      v: 2,
      openaiApiKey: OPENAI_KEY,
      currency: "EUR",
      banks: [{ name: "ING", initials: "IN" }],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.v, 3);
  assert.equal(parsed.assistant.type, "openai");
  if (parsed.assistant.type === "openai") assert.equal(parsed.assistant.apiKey, OPENAI_KEY);
});

test("local and endpoint connections round-trip and a reset clears the assistant", () => {
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
    writeConnection({
      v: 3,
      assistant: { type: "local", address: "http://localhost:11434", model: "qwen3.5:9b" },
      currency: "EUR",
      banks: [{ name: "ING", initials: "IN" }],
    });
    const local = parseConnection(store.get("haushaltsbuch.connection"));
    assert.equal(local?.assistant.type, "local");
    writeConnection({
      v: 3,
      assistant: {
        type: "endpoint",
        baseUrl: "https://llm.example.com/v1",
        model: "demo",
        apiKey: "secret",
      },
      currency: "EUR",
      banks: [{ name: "ING", initials: "IN" }],
    });
    const endpoint = parseConnection(store.get("haushaltsbuch.connection"));
    assert.equal(endpoint?.assistant.type, "endpoint");
    if (endpoint?.assistant.type === "endpoint") assert.equal(endpoint.assistant.apiKey, "secret");
    clearConnection();
    assert.equal(store.has("haushaltsbuch.connection"), false);
  } finally {
    Object.assign(globalThis, { localStorage: previousStorage, document: previousDocument });
  }
});

test("setup asks where the assistant should think before the key", () => {
  const choice = readFileSync("components/assistant/assistant-ui.tsx", "utf8");
  const setup = readFileSync("components/setup/setup-chat.tsx", "utf8");
  assert.match(choice, /Where should the assistant think\?/);
  assert.match(choice, /On OpenAI/);
  assert.match(choice, /On this computer/);
  assert.match(choice, /OpenAI-compatible endpoint/);
  assert.match(setup, /AssistantChoice/);
  assert.match(setup, /step 1 of 4/);
});

function fakeFetch(handler: (url: string, body: string) => Response): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    return handler(url, String(init?.body ?? ""));
  }) as typeof fetch;
}

test("Test connection reports each plain-language result", async () => {
  const down = await probeAssistant(
    { kind: "local", baseUrl: "http://127.0.0.1:9/v1", model: "qwen3.5:9b" },
    { fetchImpl: fakeFetch(() => { throw new Error("down"); }) },
  );
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.title, "Ollama isn't running.");

  const missing = await probeAssistant(
    { kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "missing-model" },
    {
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "qwen3.5:9b" }] });
        return Response.json({ error: "model not found" }, { status: 404 });
      }),
    },
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.title, "Connected, but the model isn't downloaded.");
    assert.equal(missing.command, "ollama pull missing-model");
  }

  const noTools = await probeAssistant(
    { kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "tiny-model" },
    {
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "tiny-model" }] });
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
      }),
    },
  );
  assert.equal(noTools.ok, false);
  if (!noTools.ok) assert.equal(noTools.title, "That model can't use tools.");

  let clock = 0;
  const slow = await probeAssistant(
    { kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:9b" },
    {
      now: () => {
        clock += 16_000;
        return clock;
      },
      fetchImpl: fakeFetch((url, body) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "qwen3.5:9b" }] });
        if (body.includes("ping")) {
          return Response.json({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [{ function: { name: "ping", arguments: "{}" } }],
                },
              },
            ],
          });
        }
        const parsed = JSON.parse(body) as { reasoning_effort?: string; options?: { num_ctx?: number } };
        assert.equal(parsed.reasoning_effort, "none");
        assert.equal(parsed.options?.num_ctx, 8192);
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
      }),
    },
  );
  assert.equal(slow.ok, true);
  if (slow.ok) assert.equal(slow.title, "Connected, but slow.");

  const endpoint = await probeAssistant(
    { kind: "endpoint", baseUrl: "https://llm.example.com/v1", model: "demo", apiKey: "secret" },
    {
      fetchImpl: fakeFetch((url, body) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "demo" }] });
        if (body.includes("ping")) {
          return Response.json({
            choices: [{ message: { tool_calls: [{ function: { name: "ping" } }] } }],
          });
        }
        assert.equal((JSON.parse(body) as { reasoning_effort?: string }).reasoning_effort, "none");
        assert.equal(body.includes("max_tokens"), false);
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      }),
    },
  );
  assert.equal(endpoint.ok, true);
  if (endpoint.ok) assert.match(endpoint.detail, /The model answered in/);
});

test("Test connection shows the endpoint's own error instead of 'couldn't reach'", async () => {
  const quota = await probeAssistant(
    { kind: "endpoint", baseUrl: "https://api.example.com/v1", model: "demo", apiKey: "secret" },
    {
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "demo" }] });
        return Response.json(
          { error: { message: "You exceeded your current quota. Key sk-abcdef123456 is fine." } },
          { status: 429 },
        );
      }),
    },
  );
  assert.equal(quota.ok, false);
  if (!quota.ok) {
    assert.equal(quota.status, "error");
    assert.equal(quota.title, "The endpoint returned an error.");
    assert.match(quota.detail, /exceeded your current quota/);
    assert.equal(quota.detail.includes("sk-abcdef"), false);
  }

  const bare = await probeAssistant(
    { kind: "endpoint", baseUrl: "https://api.example.com/v1", model: "demo", apiKey: "secret" },
    { fetchImpl: fakeFetch(() => new Response("oops", { status: 500 })) },
  );
  assert.equal(bare.ok, false);
  if (!bare.ok) assert.equal(bare.detail, "It answered with HTTP 500.");

  const empty = await probeAssistant(
    { kind: "endpoint", baseUrl: "https://api.example.com/v1", model: "demo", apiKey: "secret" },
    {
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "demo" }] });
        return Response.json({ choices: [{ message: { content: "" } }] });
      }),
    },
  );
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, "empty");
});

test("Test connection route is JSON-only and does not echo a key", async () => {
  const plain = await postAssistant(
    new Request("http://localhost/api/setup/assistant", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    }),
  );
  assert.equal(plain.status, 415);
  const refused = await postAssistant(
    new Request("http://localhost/api/setup/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "endpoint",
        baseUrl: "https://llm.example.com/v1",
        model: "",
        apiKey: "secret-key",
      }),
    }),
  );
  assert.equal(refused.status, 400);
  const text = await refused.text();
  assert.equal(text.includes("secret-key"), false);
});

test("An endpoint gets reasoning off, and the field is dropped if the model refuses it", async () => {
  const bodies: string[] = [];
  const result = await probeAssistant(
    { kind: "endpoint", baseUrl: "https://api.example.com/v1", model: "old-model", apiKey: "secret" },
    {
      fetchImpl: fakeFetch((url, body) => {
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "old-model" }] });
        bodies.push(body);
        const parsed = JSON.parse(body) as { tools?: unknown; reasoning_effort?: string };
        if (parsed.reasoning_effort !== undefined) {
          return Response.json(
            { error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } },
            { status: 400 },
          );
        }
        if (parsed.tools) {
          return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "ping" } }] } }] });
        }
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(bodies.length, 4);
  assert.equal((JSON.parse(bodies[0]) as { reasoning_effort?: string }).reasoning_effort, "none");
  assert.equal("reasoning_effort" in (JSON.parse(bodies[1]) as object), false);
});

test("The app only answers when addressed as this computer", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST", "app.localhost:3000"]) {
    assert.equal(hostAllowed(host), true, host);
  }
  for (const host of [null, "", "evil.example:3000", "192.168.1.20:3000", "localhost.evil.example", "[::1"]) {
    assert.equal(hostAllowed(host), false, String(host));
  }
  const extra = extraHostNames(" haushaltsbuch.test , my-mac.local:3000 ");
  assert.deepEqual(extra, ["haushaltsbuch.test", "my-mac.local"]);
  assert.equal(hostAllowed("haushaltsbuch.test:443", extra), true);
  assert.equal(hostAllowed("other.test", extra), false);
});

test("Setup warns, without blocking, when data would leave this computer", () => {
  assert.equal(localModelWarning("bonsai-2:9b"), null);
  assert.equal(localModelWarning("glm-ocr"), null);
  assert.ok(localModelWarning("gpt-oss:120b-cloud"));
  assert.ok(localModelWarning("glm-4.6:cloud"));
  assert.equal(endpointWarning("https://api.example.com/v1"), null);
  assert.equal(endpointWarning("http://localhost:8080/v1"), null);
  assert.equal(endpointWarning("http://127.0.0.1:1234"), null);
  assert.ok(endpointWarning("http://192.168.1.20:11434"));
  assert.ok(endpointWarning("http://api.example.com/v1"));
  assert.equal(endpointWarning("not a url"), null);
});
