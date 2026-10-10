/**
 * An unsigned edit keeps the row's sign. A leading + or - is used as typed.
 * "12.50" on an expense stays negative. "+12.50" becomes income.
 */
export function amountKeepingSign(input: string, previous: number): string {
  const trimmed = input.trim();
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
