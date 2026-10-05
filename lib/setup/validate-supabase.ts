import { hasExpectedCategories } from "./categories";
import {
  keyKind,
  parseSupabaseUrl,
  readString,
  supabaseHeaders,
} from "./guards";
import type { SetupResult } from "./types";

const TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

function invalid(error: string): SetupResult {
  return { ok: false, code: "invalid", error };
}

function rejected(error: string): SetupResult {
  return { ok: false, code: "rejected", error };
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

/**
 * Confirms the project URL and anon (or publishable) key with Supabase.
 * The key is not stored or logged.
 */
export async function validateSupabaseAnon(
  input: { supabaseUrl?: string; anonKey?: string },
  fetchImpl: FetchLike = fetch,
): Promise<SetupResult> {
  const origin = parseSupabaseUrl(input.supabaseUrl ?? "");
  if (!origin) {
    return invalid("Enter a project URL like https://xxxx.supabase.co.");
  }
  const anonKey = (input.anonKey ?? "").trim();
  if (!anonKey) return invalid("Paste the anon key.");

  const kind = keyKind(anonKey);
  if (kind === "service" || kind === "secret") {
    return invalid(
      "That looks like the service role key. Paste the anon / public key here.",
    );
  }

  let res: Response;
  try {
    res = await fetchImpl(`${origin}/rest/v1/categories?select=name&limit=1`, {
      headers: supabaseHeaders(anonKey, { accept: "application/json" }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return rejected("Could not reach that Supabase project.");
  }

  if (res.status === 200) {
    await res.body?.cancel();
    return { ok: true };
  }

  const body = await readSmallJson(res);
  const code =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code ?? "")
      : "";

  if (res.status === 404 && code === "PGRST205") return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return rejected("Supabase rejected that anon key.");
  }
  return rejected("Could not check that Supabase project.");
}

export function anonFields(body: Record<string, unknown>): {
  supabaseUrl: string;
  anonKey: string;
} {
  return {
    supabaseUrl: readString(body, "supabaseUrl"),
    anonKey: readString(body, "anonKey"),
  };
}

/** True when the category names from PostgREST include the setup seed. */
export function categoriesPayloadReady(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  const names = body.flatMap((row) => {
    if (!row || typeof row !== "object" || !("name" in row)) return [];
    const name = (row as { name?: unknown }).name;
    return typeof name === "string" ? [name] : [];
  });
  return hasExpectedCategories(names);
}
