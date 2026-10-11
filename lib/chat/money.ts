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
  if (!/^[A-Z]{3}$/.test(currency)) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
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

/**
 * Display an ISO date as "12th September 2026".
 * Format only. This does not parse relative phrases such as "today".
 */
export function formatRowDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return iso;
  }
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return `${ordinalDay(day)} ${monthName} ${year}`;
}
