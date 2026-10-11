import { parseIsoDate } from "../chat/validate-rows";
import { addDays, previousPeriod } from "./summary-range";

export const SUMMARY_STORAGE_KEY = "haushaltsbuch.summary";

export type SummaryMode = "one" | "compare";

export type DateRange = {
  from: string;
  to: string;
};

export type CompareRanges = {
  a: DateRange;
  b: DateRange;
};

export type SummaryViewState = {
  v: 1;
  mode: SummaryMode;
  one: DateRange | null;
  compare: CompareRanges | null;
};

export type RangeDraft = {
  step: "start" | "end";
  start: string | null;
  month: string;
};

export type RangeClick =
  | { kind: "draft"; draft: RangeDraft }
  | { kind: "commit"; range: DateRange };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptySummaryView(): SummaryViewState {
  return { v: 1, mode: "one", one: null, compare: null };
}

function isRange(value: unknown): value is DateRange {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.from === "string" && typeof row.to === "string" && DATE.test(row.from) && DATE.test(row.to) && row.from <= row.to && Boolean(parseIsoDate(row.from)) && Boolean(parseIsoDate(row.to));
}

export function parseSummaryView(raw: string | null | undefined): SummaryViewState {
  if (!raw) return emptySummaryView();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptySummaryView();
  }
  if (typeof data !== "object" || data === null) return emptySummaryView();
  const row = data as Record<string, unknown>;
  if (row.v !== 1) return emptySummaryView();
  const mode: SummaryMode = row.mode === "compare" ? "compare" : "one";
  const one = isRange(row.one) ? { from: row.one.from, to: row.one.to } : null;
  let compare: CompareRanges | null = null;
  if (typeof row.compare === "object" && row.compare !== null) {
    const pair = row.compare as Record<string, unknown>;
    if (isRange(pair.a) && isRange(pair.b)) {
      compare = {
        a: { from: pair.a.from, to: pair.a.to },
        b: { from: pair.b.from, to: pair.b.to },
      };
    }
  }
  return { v: 1, mode, one, compare };
}

export function readSummaryView(): SummaryViewState {
  try {
    return parseSummaryView(globalThis.localStorage?.getItem(SUMMARY_STORAGE_KEY) ?? null);
  } catch {
    return emptySummaryView();
  }
}

export function writeSummaryView(state: SummaryViewState): void {
  try {
    globalThis.localStorage?.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked. The views still keep their dates until reload.
  }
}

export function clearSummaryView(): void {
  try {
    globalThis.localStorage?.removeItem(SUMMARY_STORAGE_KEY);
  } catch {
    // The next successful reset still drops the key when storage works.
  }
}

/** One period asks only for its own range. Omitted dates mean the latest month on the server. */
export function periodSearch(range: DateRange | null): string {
  const params = new URLSearchParams({ scope: "period" });
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  return params.toString();
}

/** Compare asks for Period A and Period B and nothing from the One period list. */
export function compareSearch(compare: CompareRanges): string {
  return new URLSearchParams({
    scope: "compare",
    from: compare.a.from,
    to: compare.a.to,
    compareFrom: compare.b.from,
    compareTo: compare.b.to,
  }).toString();
}

/**
 * First time Compare opens, Period A matches One period and Period B is the previous range.
 * After that the caller keeps the stored pair and does not call this again.
 */
export function initialCompare(one: DateRange): CompareRanges | null {
  const previous = previousPeriod(one.from, one.to);
  if (!previous) return null;
  return { a: { from: one.from, to: one.to }, b: previous };
}

export function orderRange(start: string, end: string): DateRange {
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

export function openRangeDraft(month: string): RangeDraft {
  return { step: "start", start: null, month };
}

/**
 * One click chooses one date. The first click sets the start and leaves the popover open.
 * The second click sets the end, swapping the two dates when the end is earlier, and commits.
 * A click is accepted even when the day is already the saved start or end.
 */
export function clickRangeDay(draft: RangeDraft, iso: string): RangeClick {
  if (!parseIsoDate(iso)) return { kind: "draft", draft };
  if (draft.step === "start") {
    return { kind: "draft", draft: { step: "end", start: iso, month: iso } };
  }
  const start = draft.start ?? iso;
  return { kind: "commit", range: orderRange(start, iso) };
}

/** Highlight the saved range, or the hover preview after the start is chosen. */
export function previewRange(saved: DateRange | null, draft: RangeDraft, hover: string | null): DateRange | null {
  if (draft.step === "end" && draft.start) return orderRange(draft.start, hover ?? draft.start);
  return saved;
}

/**
 * One click sets that field and closes. The same day as the saved value still counts.
 * A from-date after the to-date swaps the two ends so the range stays ordered.
 */
export function applySingleDate(range: DateRange, field: "from" | "to", iso: string): DateRange | null {
  if (!parseIsoDate(iso)) return null;
  const next = field === "from" ? { from: iso, to: range.to } : { from: range.from, to: iso };
  return orderRange(next.from, next.to);
}

export function moveCalendarDay(iso: string, key: string): string | null {
  if (key === "ArrowLeft") return addDays(iso, -1);
  if (key === "ArrowRight") return addDays(iso, 1);
  if (key === "ArrowUp") return addDays(iso, -7);
  if (key === "ArrowDown") return addDays(iso, 7);
  return null;
}
