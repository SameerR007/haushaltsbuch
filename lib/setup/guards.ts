export function looksLikeOpenAiKey(key: string): boolean {
  const trimmed = key.trim();
  return /^sk-[A-Za-z0-9_-]{16,}$/.test(trimmed) && trimmed.length <= 300;
}

export function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}
