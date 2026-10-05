export function suggestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function looksLikeSecret(text: string): boolean {
  return /sk-[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{8,}|sb_(secret|publishable)_/i.test(
    text,
  );
}

export function parseCurrencyText(text: string): string | null {
  const folded = text.trim().toLowerCase();
  if (!folded) return null;
  if (folded === "€" || folded === "eur" || folded.includes("euro")) return "EUR";
  if (folded === "$" || folded === "usd" || folded.includes("dollar")) return "USD";
  if (folded === "£" || folded === "gbp" || folded.includes("pound")) return "GBP";
  const code = text.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  return null;
}

export function currencyChoiceLabel(code: string): string {
  if (code === "EUR") return "Keep euro (€)";
  if (code === "USD") return "USD ($)";
  if (code === "GBP") return "GBP (£)";
  return code;
}

export function normalizeBank(name: string, initials: string): {
  name: string;
  initials: string;
} | null {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanInitials = initials.trim().toUpperCase();
  if (!cleanName || cleanName.length > 80) return null;
  if (!/^[A-Z0-9]{1,4}$/.test(cleanInitials)) return null;
  return { name: cleanName, initials: cleanInitials };
}
