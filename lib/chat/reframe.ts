/**
 * Small local models often ignore today's date and fill in a year from training ("August" → 2024).
 * Before a chat message reaches the model, the app writes the year in for it. Plain code, no model.
 *
 * If the message already has a year, it is left alone. Otherwise every month the user names gets
 * the current year: "spent in August on food" → "spent in August 2026 on food".
 * A message without a month or a year is not changed.
 */

const MONTH_NAMES = [
  "january", "jan",
  "february", "feb",
  "march",
  "april", "apr",
  "may",
  "june", "jun",
  "july", "jul",
  "august", "aug",
  "september", "sept", "sep",
  "october", "oct",
  "november", "nov",
  "december", "dec",
];

/** These are also ordinary words ("may I", "march on"). They count as a month only in a date-like spot. */
const AMBIGUOUS = new Set(["may", "march"]);
const BEFORE_MONTH = /(?:\b(?:in|since|from|for|during|of|until|till|to|through|between|and|last|this|next|early|late|mid|on|by|before|after|about|over|across)|\d(?:st|nd|rd|th)?)\s*$/i;

const YEAR = /\b(?:19|20)\d{2}\b/;
const MONTH = new RegExp(
  `\\b(${[...MONTH_NAMES].sort((a, b) => b.length - a.length).join("|")})\\b\\.?(\\s+\\d{1,2}(?:st|nd|rd|th)?\\b)?`,
  "gi",
);

export function hasYear(text: string): boolean {
  return YEAR.test(text);
}

/** Write the current year after every month the user named, unless the message already has a year. */
export function addCurrentYear(text: string, now = new Date()): string {
  if (hasYear(text)) return text;
  const year = now.getFullYear();
  return text.replace(MONTH, (match: string, name: string, day: string | undefined, offset: number) => {
    if (AMBIGUOUS.has(name.toLowerCase()) && !day && !BEFORE_MONTH.test(text.slice(0, offset))) return match;
    return `${match} ${year}`;
  });
}

/** Read from this computer's clock on every message. Example: "Friday, 16 October 2026 (2026-10-16)". */
export function todayLine(now = new Date()): string {
  const long = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `Today is ${long} (${iso}).`;
}

/** The latest user message as the model receives it: the year filled in, then today's date. */
export function reframeForModel(text: string, now = new Date()): { question: string; content: string } {
  const question = addCurrentYear(text, now);
  return { question, content: `${question}\n\n${todayLine(now)}` };
}
