/**
 * localStorage key for a saved household connection.
 *
 * Read on the landing page (see `app/layout.tsx`) before first paint:
 * - missing or empty → first visit: “Get started” only
 * - any non-empty string → returning: “Open tracker” and “Set up again”
 *
 * Setup writes a JSON object (see `SavedConnection`) when the chat is confirmed.
 * The service role key is never part of that object.
 * A non-JSON marker such as `"1"` still counts as returning on the landing page.
 */
export const CONNECTION_STORAGE_KEY = "haushaltsbuch.connection";

/** True when `value` is a non-empty connection marker. */
export function hasSavedConnection(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

export type SavedBank = {
  name: string;
  initials: string;
};

/**
 * Browser-only household credentials and preferences.
 * `anonKey` and `openaiApiKey` stay in localStorage. There is no service role field.
 */
export type SavedConnection = {
  v: 1;
  supabaseUrl: string;
  anonKey: string;
  openaiApiKey: string;
  currency: string;
  banks: SavedBank[];
};

export function parseConnection(raw: string | null | undefined): SavedConnection | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.v !== 1) return null;
  if (
    typeof row.supabaseUrl !== "string" ||
    typeof row.anonKey !== "string" ||
    typeof row.openaiApiKey !== "string" ||
    typeof row.currency !== "string"
  ) {
    return null;
  }
  if (!row.supabaseUrl.startsWith("https://") || !/^[A-Z]{3}$/.test(row.currency)) {
    return null;
  }
  if (row.anonKey.length < 10 || row.openaiApiKey.length < 10) return null;
  if (!Array.isArray(row.banks) || row.banks.length === 0) return null;

  const banks: SavedBank[] = [];
  for (const bank of row.banks) {
    if (typeof bank !== "object" || bank === null) return null;
    const entry = bank as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.initials !== "string") return null;
    const name = entry.name.trim();
    const initials = entry.initials.trim().toUpperCase();
    if (!name || initials.length < 1 || initials.length > 4) return null;
    banks.push({ name, initials });
  }

  return {
    v: 1,
    supabaseUrl: row.supabaseUrl,
    anonKey: row.anonKey,
    openaiApiKey: row.openaiApiKey,
    currency: row.currency,
    banks,
  };
}

export function readConnection(): SavedConnection | null {
  if (typeof window === "undefined") return null;
  try {
    return parseConnection(window.localStorage.getItem(CONNECTION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeConnection(value: SavedConnection): void {
  window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(value));
  // The landing CSS reads this attribute. A client navigation back to /
  // does not re-run the head script, so set it for the current tab too.
  document.documentElement.dataset.visit = "returning";
}
