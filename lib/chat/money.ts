import { describeCurrency } from "../currency";

/**
 * Turn a typed amount into a plain signed number string.
 * Spaces are removed. A comma is the decimal mark (14,25). When both separators
 * appear, the later one is the decimal mark (1.234,50 or 1,234.50).
 */
function normalizeAmountInput(input: string): string {
  const compact = input.trim().replace(/[\s\u00a0\u202f]/g, "").replace(/^\u2212/, "-");
  if (!compact) return "";
  const sign = compact[0] === "+" || compact[0] === "-" ? compact[0] : "";
  const body = sign ? compact.slice(1) : compact;
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  let digits = body;
  if (lastComma >= 0 && lastDot >= 0) {
    digits = lastComma > lastDot ? body.replace(/\./g, "").replace(",", ".") : body.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const commas = body.match(/,/g)?.length ?? 0;
    digits = commas > 1 ? body.replace(/,/g, "") : body.replace(",", ".");
  } else if ((body.match(/\./g)?.length ?? 0) > 1) {
    digits = body.replace(/\./g, "");
  }
  return sign + digits;
}

/**
 * An unsigned edit keeps the row's sign. A leading + or - is used as typed.
 * "12.50" or "14,25" on an expense stays negative. "+12.50" becomes income.
 */
export function amountKeepingSign(input: string, previous: number): string {
  const trimmed = normalizeAmountInput(input);
  if (!trimmed || /^[+-]/.test(trimmed)) return trimmed;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return trimmed;
  if (previous < 0) return (-Math.abs(value)).toString();
  if (previous > 0) return Math.abs(value).toString();
  return trimmed;
}

/** Format a signed amount with the household currency. The symbol comes from Intl. */
export function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "";
  const known = describeCurrency(currency);
  if (!known) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: known.code,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Review-card amounts. Income keeps a plus sign in front of the currency. */
export function formatReviewAmount(amount: number, currency: string): string {
  const formatted = formatMoney(amount, currency);
  if (amount > 0 && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

/** Summary amounts use the minus sign − (U+2212), not a hyphen. */
export function formatSummaryMoney(amount: number, currency: string): string {
  const formatted = formatMoney(amount, currency);
  if (amount < 0) return formatted.replaceAll("-", "\u2212");
  return formatted;
}

/** English ordinal for a calendar day: 1st, 2nd, 3rd, 11th, 12th, 23rd. */
export function ordinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function calendarDateParts(iso: string): { day: number; monthName: string; year: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return { day, monthName, year };
}

/**
 * Display an ISO date as "12th September 2026".
 * Format only. This does not parse relative phrases such as "today".
 */
export function formatRowDate(iso: string): string {
  const parts = calendarDateParts(iso);
  if (!parts) return iso;
  return `${ordinalDay(parts.day)} ${parts.monthName} ${parts.year}`;
}

/** Display an ISO date as "1 September 2026", without an ordinal. */
export function formatPlainDate(iso: string): string {
  const parts = calendarDateParts(iso);
  if (!parts) return iso;
  return `${parts.day} ${parts.monthName} ${parts.year}`;
}
