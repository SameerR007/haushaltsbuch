import type { SavedBank } from "../connection";
import { categoriesPayloadReady } from "./validate-supabase";
import { parseSupabaseUrl, supabaseHeaders } from "./guards";

type FetchLike = typeof fetch;

export type HouseholdWrite = {
  supabaseUrl: string;
  anonKey: string;
  currency: string;
  banks: SavedBank[];
};

async function readSmallJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > 8_000) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function mapStatus(status: number, action: string): string {
  if (status === 401 || status === 403) {
    return "Supabase rejected the anon key. Use Change keys to paste a new one.";
  }
  if (status === 404) return "Tables aren’t ready yet. Create them first.";
  return `Could not ${action} in your Supabase project.`;
}

/** Reads categories with the anon key. Used after the SQL editor fallback. */
export async function schemaReady(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const origin = parseSupabaseUrl(supabaseUrl);
  if (!origin || !anonKey.trim()) return false;
  const headers = supabaseHeaders(anonKey.trim(), { accept: "application/json" });
  try {
    const [categories, banks, transactions, preferences] = await Promise.all([
      fetchImpl(`${origin}/rest/v1/categories?select=name`, {
        headers,
        cache: "no-store",
      }),
      fetchImpl(`${origin}/rest/v1/banks?select=name&limit=1`, {
        headers,
        cache: "no-store",
      }),
      fetchImpl(`${origin}/rest/v1/transactions?select=id&limit=1`, {
        headers,
        cache: "no-store",
      }),
      fetchImpl(`${origin}/rest/v1/preferences?select=currency&limit=1`, {
        headers,
        cache: "no-store",
      }),
    ]);
    if (!banks.ok || !transactions.ok || !preferences.ok || !categories.ok) {
      await Promise.all([
        categories.body?.cancel(),
        banks.body?.cancel(),
        transactions.body?.cancel(),
        preferences.body?.cancel(),
      ]);
      return false;
    }
    const names = await readSmallJson(categories);
    await Promise.all([
      banks.body?.cancel(),
      transactions.body?.cancel(),
      preferences.body?.cancel(),
    ]);
    return categoriesPayloadReady(names);
  } catch {
    return false;
  }
}

/**
 * Writes the currency preference and banks with the anon key.
 * Does not insert transactions.
 */
export async function saveHousehold(
  input: HouseholdWrite,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = parseSupabaseUrl(input.supabaseUrl);
  if (!origin) return { ok: false, error: "The project URL is missing." };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Choose a 3-letter currency code." };
  }
  if (input.banks.length === 0) {
    return { ok: false, error: "Add at least one bank." };
  }

  const headers = supabaseHeaders(input.anonKey.trim(), {
    accept: "application/json",
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  let preferenceRes: Response;
  let bankRes: Response;
  try {
    [preferenceRes, bankRes] = await Promise.all([
      fetchImpl(`${origin}/rest/v1/preferences?on_conflict=id`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: 1, currency }),
        cache: "no-store",
      }),
      fetchImpl(`${origin}/rest/v1/banks?on_conflict=name`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          input.banks.map((bank) => ({
            name: bank.name.trim(),
            initials: bank.initials.trim().toUpperCase(),
          })),
        ),
        cache: "no-store",
      }),
    ]);
  } catch {
    return { ok: false, error: "Could not reach that Supabase project." };
  }

  await preferenceRes.body?.cancel().catch(() => undefined);
  await bankRes.body?.cancel().catch(() => undefined);

  if (!preferenceRes.ok) {
    return { ok: false, error: mapStatus(preferenceRes.status, "save the currency") };
  }
  if (!bankRes.ok) {
    return { ok: false, error: mapStatus(bankRes.status, "save the banks") };
  }
  return { ok: true };
}
