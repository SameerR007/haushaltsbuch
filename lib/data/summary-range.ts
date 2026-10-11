import { formatRowDate } from "../chat/money";
import { parseIsoDate } from "../chat/validate-rows";

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function addDays(iso: string, days: number): string | null {
  const parsed = parseIsoDate(iso);
  if (!parsed) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function inclusiveDays(from: string, to: string): number | null {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end || start > end) return null;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const a = Date.UTC(sy, sm - 1, sd);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** First and last calendar day of the month that contains `iso`. */
export function monthRangeContaining(iso: string): { from: string; to: string } | null {
  const parsed = parseIsoDate(iso);
  if (!parsed) return null;
  const [year, month] = parsed.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export function isWholeMonth(from: string, to: string): boolean {
  const range = monthRangeContaining(from);
  return range !== null && range.from === from && range.to === to;
}

export function isWholeYear(from: string, to: string): boolean {
  return /^\d{4}-01-01$/.test(from) && /^\d{4}-12-31$/.test(to) && from.slice(0, 4) === to.slice(0, 4);
}

export function yearRange(iso: string): { from: string; to: string } | null {
  const parsed = parseIsoDate(iso);
  if (!parsed) return null;
  const year = parsed.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * The comparison window for a chosen range.
 * A whole calendar month compares with the previous calendar month.
 * A whole year compares with the previous calendar year.
 * Any other range compares with the same number of days ending the day before the start.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } | null {
  if (!parseIsoDate(from) || !parseIsoDate(to) || from > to) return null;
  if (isWholeMonth(from, to)) {
    const dayBefore = addDays(from, -1);
    return dayBefore ? monthRangeContaining(dayBefore) : null;
  }
  if (isWholeYear(from, to)) {
    const year = Number(from.slice(0, 4)) - 1;
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const days = inclusiveDays(from, to);
  if (!days) return null;
  const compareTo = addDays(from, -1);
  if (!compareTo) return null;
  const compareFrom = addDays(compareTo, -(days - 1));
  if (!compareFrom) return null;
  return { from: compareFrom, to: compareTo };
}

/** Latest month, then the two calendar months before it. */
export function recentMonthRanges(latestFrom: string): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  let cursor: string | null = latestFrom;
  for (let index = 0; index < 3 && cursor; index += 1) {
    const range = monthRangeContaining(cursor);
    if (!range) break;
    ranges.push(range);
    cursor = addDays(range.from, -1);
  }
  return ranges;
}

export function monthYearLabel(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const [year, month] = parsed.split("-").map(Number);
  const name = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return `${name} ${year}`;
}

export function wholeYearLabel(year: number): string {
  return `Whole year ${year}`;
}

export function rangeLabel(from: string, to: string): string {
  return `${formatRowDate(from)} – ${formatRowDate(to)}`;
}

export function magnitudeChange(currentSigned: number, previousSigned: number): number {
  return roundCents(Math.abs(currentSigned) - Math.abs(previousSigned));
}

/** One decimal. Null when the earlier magnitude is zero. */
export function changePercent(delta: number, previousMagnitude: number): number | null {
  if (previousMagnitude === 0) return null;
  return Math.round((delta / previousMagnitude) * 1000) / 10;
}

export function calendarCells(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= last; day += 1) cells.push(day);
  return cells;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function categoryComparison(
  current: readonly { category: string; amount: number }[],
  previous: readonly { category: string; amount: number }[],
): { category: string; periodA: number; periodB: number }[] {
  const names = new Set<string>([
    ...current.map((row) => row.category),
    ...previous.map((row) => row.category),
  ]);
  const periodA = new Map(current.map((row) => [row.category, row.amount]));
  const periodB = new Map(previous.map((row) => [row.category, row.amount]));
  return [...names]
    .map((category) => ({
      category,
      periodA: periodA.get(category) ?? 0,
      periodB: periodB.get(category) ?? 0,
    }))
    .sort(
      (left, right) =>
        Math.abs(right.periodA) - Math.abs(left.periodA) ||
        Math.abs(right.periodB) - Math.abs(left.periodB) ||
        left.category.localeCompare(right.category),
    );
}

export function sharePercent(amount: number, totalSigned: number): number {
  const total = Math.abs(totalSigned);
  if (total === 0) return 0;
  return Math.round((Math.abs(amount) / total) * 100);
}
