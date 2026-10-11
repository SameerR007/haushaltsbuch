export type KnownCurrency = {
  code: string;
  symbol: string;
  name: string;
};

export const UNKNOWN_CURRENCY_ERROR =
  "That currency code isn’t recognized. Enter a three-letter ISO code such as CHF, JPY, or SEK.";

const CODE = /^[A-Z]{3}$/;

function supportedCodes(): ReadonlySet<string> | null {
  if (typeof Intl.supportedValuesOf !== "function") return null;
  return new Set(Intl.supportedValuesOf("currency"));
}

/** "Swiss Franc" → "Swiss franc". All-caps words such as "US" stay as written. */
function sentenceName(raw: string): string {
  return raw
    .split(" ")
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 2 && letters === letters.toUpperCase()) return word;
      const lower = word.toLowerCase();
      if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(" ");
}

/**
 * A currency Intl can format. Codes outside Intl.supportedValuesOf('currency')
 * are rejected: NumberFormat would otherwise print the code itself as a symbol.
 */
export function describeCurrency(code: string): KnownCurrency | null {
  const normalized = code.trim().toUpperCase();
  if (!CODE.test(normalized)) return null;
  const supported = supportedCodes();
  if (supported && !supported.has(normalized)) return null;
  try {
    const format = new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalized,
      currencyDisplay: "narrowSymbol",
    });
    const symbol = format.formatToParts(0).find((part) => part.type === "currency")?.value;
    const rawName = new Intl.DisplayNames("en", { type: "currency" }).of(normalized);
    if (!symbol || !rawName || rawName.toUpperCase() === normalized) return null;
    return { code: normalized, symbol, name: sentenceName(rawName) };
  } catch {
    return null;
  }
}

/** Confirmation line for a typed code, e.g. "CHF — Swiss franc". */
export function currencyConfirmLabel(currency: KnownCurrency): string {
  return `${currency.code} — ${currency.name}`;
}

export function currencyFractionDigits(code: string): number {
  const known = describeCurrency(code);
  if (!known) return 2;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: known.code,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : 2;
  } catch {
    return 2;
  }
}

/** Excel number format for the saved currency. Unknown codes stay a plain number. */
export function excelAmountNumFmt(code: string): string {
  const known = describeCurrency(code);
  if (!known) return "0.00";
  const digits = currencyFractionDigits(known.code);
  const decimals = digits > 0 ? `.${"0".repeat(digits)}` : "";
  const body = `#,##0${decimals}`;
  const symbol = known.symbol.replaceAll('"', '""');
  return `"${symbol}"${body};"-${symbol}"${body}`;
}
