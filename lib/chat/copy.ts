export const EMPTY_HEADING = "What did you spend?";

export const EMPTY_SUBTITLE =
  "Type it in plain language, or attach a bank statement PDF with the paperclip.";

export const PLACEHOLDER_EMPTY = "Type an expense, or attach a bank statement (PDF)";

export const PLACEHOLDER_FOLLOWUP = "Ask a follow-up, or attach another statement";

export const PDF_DISCLOSURE =
  "The whole PDF (text and page images) is sent to OpenAI to read it. Nothing else leaves your computer.";

export const READING_STATEMENT = "Reading your statement…";

export const REVIEW_FOOTER =
  "Bank and currency come from your setup. Categories are suggestions. Uncertain rows are flagged for you to fix.";

export function reviewIntro(count: number, sourceName: string | null): string {
  const noun = count === 1 ? "transaction" : "transactions";
  const where = sourceName ? ` in ${sourceName}` : "";
  return `I found ${count} ${noun}${where}. Nothing is saved yet — check them first.`;
}

export function confirmLabel(count: number): string {
  const noun = count === 1 ? "transaction" : "transactions";
  return `Confirm — save ${count} ${noun}`;
}

export function totalLabel(sourceName: string | null): string {
  return sourceName ? "Total from statement" : "Total";
}
