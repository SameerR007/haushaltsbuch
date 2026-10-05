import { loadSetupSql } from "./schema";
import { categoriesPayloadReady } from "./validate-supabase";
import {
  keyKind,
  parseSupabaseUrl,
  projectRef,
  readString,
  supabaseHeaders,
} from "./guards";
import type { SetupResult } from "./types";

const TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

const TABLES = ["categories", "banks", "transactions", "preferences"] as const;

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

async function readSmallJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > 8_000) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function schemaVisible(
  origin: string,
  key: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  const headers = supabaseHeaders(key, { accept: "application/json" });
  let categories: Response;
  let banks: Response;
  let transactions: Response;
  let preferences: Response;
  try {
    [categories, banks, transactions, preferences] = await Promise.all([
      fetchImpl(`${origin}/rest/v1/categories?select=name`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetchImpl(`${origin}/rest/v1/banks?select=name&limit=1`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetchImpl(`${origin}/rest/v1/transactions?select=id&limit=1`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetchImpl(`${origin}/rest/v1/preferences?select=currency&limit=1`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    ]);
  } catch {
    return false;
  }

  if (!banks.ok || !transactions.ok || !preferences.ok || !categories.ok) {
    await Promise.all([
      discard(categories),
      discard(banks),
      discard(transactions),
      discard(preferences),
    ]);
    return false;
  }

  const names = await readSmallJson(categories);
  await Promise.all([discard(banks), discard(transactions), discard(preferences)]);
  return categoriesPayloadReady(names);
}

/**
 * Verifies the service role key, applies supabase/setup.sql once, then drops
 * the key. Nothing here is written to disk or included in the return value.
 */
export async function createTables(
  input: { supabaseUrl?: string; serviceRoleKey?: string },
  fetchImpl: FetchLike = fetch,
): Promise<SetupResult<{ tables: string[] }>> {
  const origin = parseSupabaseUrl(input.supabaseUrl ?? "");
  if (!origin) {
    return {
      ok: false,
      code: "invalid",
      error: "Enter a project URL like https://xxxx.supabase.co.",
    };
  }

  const serviceRoleKey = (input.serviceRoleKey ?? "").trim();
  if (!serviceRoleKey) {
    return { ok: false, code: "invalid", error: "Paste the service role key." };
  }

  const kind = keyKind(serviceRoleKey);
  if (kind === "anon" || kind === "publishable") {
    return {
      ok: false,
      code: "invalid",
      error: "That is the anon key. Paste the service role / secret key.",
    };
  }
  if (kind !== "service" && kind !== "secret") {
    return {
      ok: false,
      code: "invalid",
      error: "That doesn’t look like a service role key.",
    };
  }

  let admin: Response;
  try {
    admin = await fetchImpl(
      `${origin}/auth/v1/admin/users?page=1&per_page=1`,
      {
        headers: supabaseHeaders(serviceRoleKey),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return {
      ok: false,
      code: "rejected",
      error: "Could not reach that Supabase project.",
    };
  }

  await discard(admin);
  if (admin.status === 401 || admin.status === 403) {
    return {
      ok: false,
      code: "rejected",
      error: "Supabase rejected that service role key.",
    };
  }
  if (!admin.ok) {
    return {
      ok: false,
      code: "rejected",
      error: "Could not verify the service role key.",
    };
  }

  let sqlRes: Response;
  try {
    sqlRes = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef(origin)}/database/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: loadSetupSql() }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return {
      ok: false,
      code: "ddl_unavailable",
      error:
        "The service role key was checked, then discarded. Create the tables from the setup SQL in the Supabase SQL editor.",
    };
  }

  await discard(sqlRes);
  if (!sqlRes.ok) {
    return {
      ok: false,
      code: "ddl_unavailable",
      error:
        "Supabase accepted the service role key, but this project can’t create tables from the app. The key was discarded. Run the setup SQL in the SQL editor, then check tables.",
    };
  }

  let visible = await schemaVisible(origin, serviceRoleKey, fetchImpl);
  if (!visible) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    visible = await schemaVisible(origin, serviceRoleKey, fetchImpl);
  }
  if (!visible) {
    return {
      ok: false,
      code: "incomplete",
      error:
        "The table SQL was sent, but the new tables aren’t readable yet. Run the setup SQL in the SQL editor if they don’t appear, then check tables.",
    };
  }

  return { ok: true, tables: [...TABLES] };
}

export function serviceRoleFields(body: Record<string, unknown>): {
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  return {
    supabaseUrl: readString(body, "supabaseUrl"),
    serviceRoleKey: readString(body, "serviceRoleKey"),
  };
}
