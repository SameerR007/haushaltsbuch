import { skippedScansNote } from "@/lib/assistant/copy";
import type { Proposal, ReviewRow, StatementReview } from "./types";

export type { StatementReview };

export type BalanceVerdict =
  | { status: "pass"; change: number; sum: number; opening: number; closing: number }
  | { status: "mismatch"; change: number; sum: number; opening: number; closing: number; missing: number }
  | { status: "hidden" };

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function parseLooseAmount(raw: string): number | null {
  const compact = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!compact) return null;
  const sign = compact.startsWith("-") || compact.startsWith("\u2212") ? -1 : 1;
  const body = compact.replace(/^[+-]/, "").replace(/^\u2212/, "");
  if (!body) return null;
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  let normalized = body;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? body.replace(/\./g, "").replace(",", ".") : body.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = body.length - lastComma - 1;
    normalized = decimals === 2 ? body.replace(",", ".") : body.replace(/,/g, "");
  } else if ((body.match(/\./g)?.length ?? 0) > 1) {
    normalized = body.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return roundMoney(sign * value);
}

export type ParsedStatementFacts = {
  account: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  opening: number | null;
  closing: number | null;
};

const OPENING_LABELS = ["opening balance", "anfangssaldo", "alter kontostand", "alter saldo", "starting balance"];
const CLOSING_LABELS = ["closing balance", "endsaldo", "neuer kontostand", "neuer saldo", "ending balance"];

export function parseStatementFacts(text: string): ParsedStatementFacts {
  return {
    account: matchAccount(text),
    ...matchPeriod(text),
    opening: matchLabeledAmount(text, OPENING_LABELS),
    closing: matchLabeledAmount(text, CLOSING_LABELS),
  };
}

function matchAccount(text: string): string | null {
  const match = /(?:^|\n)\s*(?:account|konto)\s*:\s*([^\n]+)/i.exec(text);
  const name = match?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  if (!name || name.length > 80) return name ? name.slice(0, 80) : null;
  return name;
}

function matchPeriod(text: string): { periodStart: string | null; periodEnd: string | null } {
  const dotted = /(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\d{2}\.\d{2}\.\d{4})/.exec(text);
  if (dotted?.[1] && dotted[2]) {
    return { periodStart: dottedToIso(dotted[1]), periodEnd: dottedToIso(dotted[2]) };
  }
  const iso = /(\d{4}-\d{2}-\d{2})\s*[–—-]\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso?.[1] && iso[2]) return { periodStart: iso[1], periodEnd: iso[2] };
  return { periodStart: null, periodEnd: null };
}

function dottedToIso(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const year = Number(match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return iso;
}

function matchLabeledAmount(text: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]?\\s*([+-]?\\d[\\d.,\\t \\u00a0]*)`, "i");
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const amount = parseLooseAmount(match[1]);
    if (amount !== null) return amount;
  }
  return null;
}

export function reconcileBalances(opening: number, closing: number, rows: readonly { amount: number | null }[]): BalanceVerdict {
  const change = roundMoney(closing - opening);
  const sum = roundMoney(rows.reduce((total, row) => total + (row.amount ?? 0), 0));
  if (Math.round(change * 100) === Math.round(sum * 100)) {
    return { status: "pass", change, sum, opening, closing };
  }
  return {
    status: "mismatch",
    change,
    sum,
    opening,
    closing,
    missing: roundMoney(Math.abs(change - sum)),
  };
}

export function formatSignedAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
  if (currency === "EUR") return `\u20ac${sign}${abs}`;
  return `${sign}${abs} ${currency}`;
}

export function formatPlainAmount(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMissingAmount(amount: number, currency: string): string {
  const abs = formatPlainAmount(amount);
  if (currency === "EUR") return `\u20ac${abs}`;
  return `${abs} ${currency}`;
}

export function balancePassedText(verdict: Extract<BalanceVerdict, { status: "pass" }>, currency: string): string {
  return `Balance check passed: rows add up to the ${formatSignedAmount(verdict.change, currency)} change from ${formatPlainAmount(verdict.opening)} to ${formatPlainAmount(verdict.closing)}.`;
}

export function balanceMismatchText(verdict: Extract<BalanceVerdict, { status: "mismatch" }>, currency: string): string {
  return `These rows add up to ${formatSignedAmount(verdict.sum, currency)}. The whole statement changed by ${formatSignedAmount(verdict.change, currency)}. If you asked for every row, ${formatMissingAmount(verdict.missing, currency)} is missing: check the amounts below.`;
}

export function skippedNote(statement: StatementReview): string | null {
  if (statement.skippedPages.length === 0 || statement.failedPage) return null;
  return skippedScansNote(statement.skippedPages);
}

export function blankStatementRow(proposal: Proposal): ReviewRow {
  const bank = proposal.banks[0];
  const category = proposal.categories.includes("miscellaneous")
    ? "miscellaneous"
    : (proposal.categories[0] ?? "");
  return {
    date: null,
    dateInput: "",
    description: "",
    category,
    bank: bank?.name ?? "",
    bankInitials: bank?.initials ?? null,
    amount: null,
    amountInput: "",
    flags: ["uncertain", "invalid_date", "invalid_amount"],
    duplicateOf: null,
    duplicateKey: null,
    draft: true,
  };
}

export function pageHasUsableText(text: string): boolean {
  const letters = text.replace(/[^0-9A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/g, "");
  return letters.length >= 24;
}

export function textLooksUseful(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 12) return false;
  const letters = trimmed.replace(/[^0-9A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/g, "");
  if (letters.length < 8) return false;
  return letters.length / trimmed.length >= 0.25;
}
