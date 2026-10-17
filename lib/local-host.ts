/**
 * The app answers only when the browser asked for it by a name of this computer.
 * Another site that points its own domain at 127.0.0.1 ("DNS rebinding") sends its
 * own name in the Host header and is refused, so it cannot read or change the data.
 */
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** "localhost:3000" → "localhost", "[::1]:3000" → "::1". Empty when it can't be read. */
export function hostName(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? "" : host.slice(1, end);
  }
  return host.split(":")[0] ?? "";
}

/** Extra names from HAUSHALTSBUCH_ALLOWED_HOSTS, for example a reverse proxy or a *.test name. */
export function extraHostNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((name) => hostName(name))
    .filter(Boolean);
}

export function hostAllowed(hostHeader: string | null, extra: readonly string[] = []): boolean {
  if (!hostHeader) return false;
  const name = hostName(hostHeader);
  if (!name) return false;
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost") || extra.includes(name);
}
