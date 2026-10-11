import { currencyConfirmLabel, describeCurrency } from "../currency";

export const CURRENCY_CHOICES = [
  { code: "EUR", label: "Euro (€)" },
  { code: "INR", label: "INR (₹)" },
  { code: "USD", label: "USD ($)" },
] as const;

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
  if (folded === "₹" || folded === "inr" || folded.includes("rupee")) return "INR";
  if (folded === "$" || folded === "usd" || folded.includes("dollar")) return "USD";
  if (folded === "£" || folded === "gbp" || folded.includes("pound")) return "GBP";
  const code = text.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return describeCurrency(code)?.code ?? null;
}

export function currencyChoiceLabel(code: string): string {
  const choice = CURRENCY_CHOICES.find((item) => item.code === code);
  if (choice) return choice.label;
  const known = describeCurrency(code);
  return known ? currencyConfirmLabel(known) : code;
}

/** Short label for subtitles and cards: "INR (₹)", "EUR (€)". */
export function currencySummaryLabel(code: string): string {
  const known = describeCurrency(code);
  if (!known) return code;
  return `${known.code} (${known.symbol})`;
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
