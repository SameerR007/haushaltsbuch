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

/** Display an ISO date as "02 Nov". Not a relative-date parser. */
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
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${String(day).padStart(2, "0")} ${monthName}`;
}
