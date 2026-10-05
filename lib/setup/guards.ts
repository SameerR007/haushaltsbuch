export type KeyKind = "anon" | "service" | "publishable" | "secret" | "unknown";

const PROJECT_HOST = /^[a-z0-9]{8,40}\.supabase\.co$/;

/** Origin of a hosted Supabase project, or null when the URL is not one. */
export function parseSupabaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!PROJECT_HOST.test(host)) return null;
  return `https://${host}`;
}

export function projectRef(origin: string): string {
  return new URL(origin).hostname.split(".")[0] ?? "";
}

export function projectHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function decodeBase64Url(input: string): string {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  return atob(padded);
}

/** Role claim from a JWT-shaped key. Does not verify the signature. */
export function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function keyKind(key: string): KeyKind {
  const trimmed = key.trim();
  if (trimmed.startsWith("sb_publishable_")) return "publishable";
  if (trimmed.startsWith("sb_secret_")) return "secret";
  const role = jwtRole(trimmed);
  if (role === "anon") return "anon";
  if (role === "service_role") return "service";
  return "unknown";
}

export function looksLikeOpenAiKey(key: string): boolean {
  const trimmed = key.trim();
  return /^sk-[A-Za-z0-9_-]{16,}$/.test(trimmed) && trimmed.length <= 300;
}

/**
 * Headers for the project Data/Auth API.
 * New sb_ keys go on `apikey` only. Legacy JWTs also use Authorization.
 */
export function supabaseHeaders(
  key: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra, apikey: key };
  if (!key.startsWith("sb_")) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}
