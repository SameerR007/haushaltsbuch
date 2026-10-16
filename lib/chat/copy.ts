export const EMPTY_HEADING = "What did you spend?";

export const EMPTY_SUBTITLE =
  "Type it in plain language, or attach a bank statement PDF with the paperclip.";

export const EMPTY_SUBTITLE_TYPED = "Type it in plain language.";

export const PLACEHOLDER_EMPTY = "Type an expense, or attach a bank statement (PDF)";

export const PLACEHOLDER_TYPED = "Type an expense";

export const PLACEHOLDER_FOLLOWUP = "Ask a follow-up, or attach another statement";

export const PDF_DISCLOSURE =
  "This PDF goes to OpenAI so it can be read. Nothing is saved until you confirm.";

export function pdfGoesTo(host: string): string {
  const where = host.trim() || "the address you entered";
  return `This PDF goes to ${where} so it can be read. Nothing is saved until you confirm.`;
}

export const READING_STATEMENT = "Reading your statement…";

export const REATTACH_PDF = "Attach the statement again. The file is not kept in this browser.";

export const NEW_CHAT_CONFIRM = "Discard the review card? It is not saved yet.";

export const REVIEW_NOTE =
  "Please check every row before you save. The assistant can sometimes misread a date or an amount, or add a row that should not be there. Click any cell to change it. When you confirm, the rows are saved as shown.";

export const REVIEW_FOOTER = "Bank and currency come from your setup. Categories are suggestions.";

export function reviewIntro(count: number, sourceName: string | null): string {
  const noun = count === 1 ? "transaction" : "transactions";
  const where = sourceName ? ` in ${sourceName}` : "";
  return `I found ${count} ${noun}${where}. Nothing is saved yet.`;
}

export function confirmLabel(count: number): string {
  const noun = count === 1 ? "transaction" : "transactions";
  return `Confirm — save ${count} ${noun}`;
}

export function totalLabel(sourceName: string | null): string {
  return sourceName ? "Total from statement" : "Total";
}
