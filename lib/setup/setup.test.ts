import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { hasSavedConnection, parseConnection } from "../connection";
import { EXPECTED_CATEGORIES } from "./categories";
import {
  currencyChoiceLabel,
  looksLikeSecret,
  normalizeBank,
  parseCurrencyText,
  suggestInitials,
} from "./chat-logic";
import { createTables } from "./create-tables";
import {
  keyKind,
  parseSupabaseUrl,
  supabaseHeaders,
} from "./guards";
import { saveHousehold, schemaReady } from "./household";
import { loadSetupSql } from "./schema";
import { validateOpenAiKey } from "./validate-openai";
import { validateSupabaseAnon } from "./validate-supabase";

const PROJECT = "https://abcdefgh.supabase.co";
const SERVICE_KEY = jwt({ role: "service_role" });
const ANON_KEY = jwt({ role: "anon" });

function jwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

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

test("project URLs are hosted Supabase origins", () => {
  assert.equal(parseSupabaseUrl(" https://abcdefgh.supabase.co/rest/v1 "), PROJECT);
  assert.equal(parseSupabaseUrl("https://ABCDEFGH.supabase.co"), PROJECT);
  assert.equal(parseSupabaseUrl("http://abcdefgh.supabase.co"), null);
  assert.equal(parseSupabaseUrl("https://evil.example"), null);
  assert.equal(parseSupabaseUrl("https://user:pw@abcdefgh.supabase.co"), null);
  assert.equal(parseSupabaseUrl("https://abcdefgh.supabase.co:8443"), null);
  assert.equal(parseSupabaseUrl("https://localhost/"), null);
});

test("key kinds distinguish anon and service role", () => {
  assert.equal(keyKind(ANON_KEY), "anon");
  assert.equal(keyKind(SERVICE_KEY), "service");
  assert.equal(keyKind("sb_publishable_example"), "publishable");
  assert.equal(keyKind("sb_secret_example"), "secret");
  const publishable = supabaseHeaders("sb_publishable_example");
  assert.equal(publishable.apikey, "sb_publishable_example");
  assert.equal("Authorization" in publishable, false);
  assert.equal(supabaseHeaders(ANON_KEY).Authorization, `Bearer ${ANON_KEY}`);
});

test("setup SQL is idempotent, seeded, and empty of money rows", () => {
  const sql = loadSetupSql();
  const file = readFileSync(join(process.cwd(), "supabase/setup.sql"), "utf8");
  assert.equal(sql, file);
  for (const table of ["categories", "banks", "transactions", "preferences"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`create policy if not exists household_anon_all on public\\.${table}`));
  }
  for (const name of EXPECTED_CATEGORIES) {
    assert.match(sql, new RegExp(`'${name}'`));
  }
  assert.match(sql, /default 'EUR'/);
  assert.match(sql, /insert into public\.categories/);
  assert.match(sql, /insert into public\.preferences/);
  assert.doesNotMatch(sql, /insert into public\.transactions/i);
  assert.doesNotMatch(sql, /insert into public\.banks/i);
  assert.doesNotMatch(sql, /sk-|service_role key|eyJ/);
});

test("connection JSON keeps anon and OpenAI keys and drops a service role field", () => {
  assert.equal(hasSavedConnection("1"), true);
  assert.equal(hasSavedConnection(""), false);
  assert.equal(parseConnection("1"), null);
  const parsed = parseConnection(
    JSON.stringify({
      v: 1,
      supabaseUrl: PROJECT,
      anonKey: ANON_KEY,
      openaiApiKey: "sk-openai-example-key",
      currency: "EUR",
      banks: [{ name: "ING", initials: "in" }],
      serviceRoleKey: SERVICE_KEY,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.banks[0]?.initials, "IN");
  assert.equal(JSON.stringify(parsed).includes(SERVICE_KEY), false);
  assert.equal("serviceRoleKey" in parsed, false);
});

test("validate accepts anon and refuses the service role without calling Supabase", async () => {
  let calls = 0;
  const fetchImpl = mockFetch(() => {
    calls += 1;
    return new Response("{}", { status: 500 });
  });
  const refused = await validateSupabaseAnon(
    { supabaseUrl: PROJECT, anonKey: SERVICE_KEY },
    fetchImpl,
  );
  assert.equal(refused.ok, false);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(refused).includes(SERVICE_KEY), false);

  const missing = await validateSupabaseAnon(
    { supabaseUrl: PROJECT, anonKey: ANON_KEY },
    mockFetch(
      () =>
        new Response(JSON.stringify({ code: "PGRST205" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  assert.equal(missing.ok, true);

  const bad = await validateSupabaseAnon(
    { supabaseUrl: PROJECT, anonKey: ANON_KEY },
    mockFetch(() => new Response("{}", { status: 401 })),
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.includes(ANON_KEY), false);
});

test("create-tables uses the service role once and does not return it", async () => {
  const calls: string[] = [];
  const okFetch = mockFetch((url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/auth/v1/admin/users")) return new Response("[]", { status: 200 });
    if (url.startsWith("https://api.supabase.com/")) {
      assert.equal(header(init, "authorization"), `Bearer ${SERVICE_KEY}`);
      const body = JSON.parse(String(init?.body)) as { query?: string };
      assert.match(body.query ?? "", /create table if not exists public\.categories/);
      return new Response("[]", { status: 201 });
    }
    if (url.includes("/categories")) {
      return Response.json(EXPECTED_CATEGORIES.map((name) => ({ name })));
    }
    return Response.json([]);
  });
  const created = await createTables(
    { supabaseUrl: PROJECT, serviceRoleKey: SERVICE_KEY },
    okFetch,
  );
  assert.deepEqual(created, {
    ok: true,
    tables: ["categories", "banks", "transactions", "preferences"],
  });
  assert.equal(JSON.stringify(created).includes(SERVICE_KEY), false);
  assert.equal(calls.some((call) => call.includes("api.supabase.com")), true);

  let refusedCalls = 0;
  const refused = await createTables(
    { supabaseUrl: PROJECT, serviceRoleKey: ANON_KEY },
    mockFetch(() => {
      refusedCalls += 1;
      return new Response("{}", { status: 200 });
    }),
  );
  assert.equal(refused.ok, false);
  assert.equal(refusedCalls, 0);

  const ddlCalls: string[] = [];
  const ddl = await createTables(
    { supabaseUrl: PROJECT, serviceRoleKey: SERVICE_KEY },
    mockFetch((url, init) => {
      ddlCalls.push(url);
      if (url.includes("/auth/v1/admin/users")) return new Response("{}", { status: 200 });
      assert.equal(init?.method, "POST");
      return new Response("{}", { status: 401 });
    }),
  );
  assert.equal(ddl.ok, false);
  if (!ddl.ok) {
    assert.equal(ddl.code, "ddl_unavailable");
    assert.equal(ddl.error.includes(SERVICE_KEY), false);
  }
  assert.equal(ddlCalls.length, 2);
});

test("OpenAI check does not echo the key", async () => {
  const key = "sk-openai-example-key";
  let called = "";
  const ok = await validateOpenAiKey(
    { apiKey: key },
    mockFetch((url, init) => {
      called = url;
      assert.equal(header(init, "authorization"), `Bearer ${key}`);
      return new Response("{}", { status: 200 });
    }),
  );
  assert.equal(ok.ok, true);
  assert.equal(called, "https://api.openai.com/v1/models");

  const rejected = await validateOpenAiKey(
    { apiKey: key },
    mockFetch(() => new Response("{}", { status: 401 })),
  );
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(rejected).includes(key), false);
  const skipped = await validateOpenAiKey({ apiKey: "nope" }, mockFetch(() => {
    throw new Error("should not fetch");
  }));
  assert.equal(skipped.ok, false);
});

test("household save writes currency and banks, not transactions", async () => {
  const posts: { url: string; body: string; apikey: string | null }[] = [];
  const result = await saveHousehold(
    {
      supabaseUrl: PROJECT,
      anonKey: ANON_KEY,
      currency: "eur",
      banks: [{ name: "ING", initials: "in" }],
    },
    mockFetch(async (url, init) => {
      posts.push({
        url,
        body: String(init?.body ?? ""),
        apikey: header(init, "apikey"),
      });
      return new Response(null, { status: 201 });
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(posts.length, 2);
  assert.equal(
    posts.some((post) => post.url.includes("/transactions")),
    false,
  );
  const preference = posts.find((post) => post.url.includes("/preferences"));
  const banks = posts.find((post) => post.url.includes("/banks"));
  assert.match(preference?.body ?? "", /"currency":"EUR"/);
  assert.match(banks?.body ?? "", /"initials":"IN"/);
  for (const post of posts) {
    assert.equal(post.apikey, ANON_KEY);
    assert.equal(post.body.includes(SERVICE_KEY), false);
  }
});

test("schema check accepts the seeded category names", async () => {
  const ready = await schemaReady(
    PROJECT,
    ANON_KEY,
    mockFetch((url) => {
      if (url.includes("/categories")) {
        return Response.json(EXPECTED_CATEGORIES.map((name) => ({ name })));
      }
      return Response.json([]);
    }),
  );
  assert.equal(ready, true);
  const missing = await schemaReady(
    PROJECT,
    ANON_KEY,
    mockFetch(() => Response.json([{ name: "food" }])),
  );
  assert.equal(missing, false);
});

test("chat helpers", () => {
  assert.equal(suggestInitials("ing diba"), "ID");
  assert.equal(suggestInitials("N26"), "N26");
  assert.equal(parseCurrencyText("keep euro"), "EUR");
  assert.equal(parseCurrencyText("CHF"), "CHF");
  assert.equal(currencyChoiceLabel("USD"), "USD ($)");
  assert.equal(looksLikeSecret("my key sk-abc"), true);
  assert.equal(looksLikeSecret("one bank"), false);
  assert.deepEqual(normalizeBank("  ING  ", "in"), { name: "ING", initials: "IN" });
  assert.equal(normalizeBank("ING", ""), null);
});

test("setup server code does not log", () => {
  const roots = ["lib/setup", "app/api/setup", "components/setup"];
  const files = roots.flatMap((dir) => walk(dir));
  assert.ok(files.length > 5);
  for (const file of files) {
    if (file.endsWith("setup.test.ts")) continue;
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("console."), false, file);
  }
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}
