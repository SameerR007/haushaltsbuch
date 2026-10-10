import type { BankRef } from "./types";

export const RUN_SQL_RULE =
  "Call run_sql before you answer with any amount, total, balance, count, or other figure from this household's money. Do not use numbers from memory.";

export const SIGNED_AMOUNT_RULE =
  "Amounts are signed: expenses are negative, income (salary and other incoming money) is positive. A balance is a plain SUM of amount.";

export const AMBIGUITY_RULE =
  "If the bank or the category is ambiguous, ask a short question instead of guessing. When only one bank is saved, that bank is the default.";

export const PROPOSE_RULE =
  "propose_transactions does not save anything. The user reviews the rows and confirms before they are written.";

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Day 12 of the previous full calendar month, in the local timezone. */
export function previousFullMonth(now = new Date()): {
  monthName: string;
  dayPhrase: string;
  isoDay12: string;
} {
  const day = new Date(now.getFullYear(), now.getMonth() - 1, 12);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(day);
  const isoDay12 = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-12`;
  return { monthName, dayPhrase: `12 ${monthName}`, isoDay12 };
}

export function previousMonthIso(dayOfMonth: number, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth() - 1, dayOfMonth);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function fractionDigits(currency?: string | null): number {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return 2;
  try {
    const digits = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : 2;
  } catch {
    return 2;
  }
}

function sampleAmount(currency?: string | null): string {
  const digits = fractionDigits(currency);
  return (12.5).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Suggested first-screen prompts. Bank and currency come from saved setup. */
export function suggestedPrompts(input: {
  bankName?: string | null;
  currency?: string | null;
  now?: Date;
}): [string, string, string] {
  const { monthName, dayPhrase } = previousFullMonth(input.now ?? new Date());
  const amount = sampleAmount(input.currency);
  const bank = input.bankName?.trim() ?? "";
  const add = bank
    ? `Add ${amount} groceries from ${bank} on ${dayPhrase}`
    : `Add ${amount} groceries on ${dayPhrase}`;
  return [
    add,
    `Add the expenses for ${monthName} from this bank statement`,
    `How much did I spend on food in ${monthName}?`,
  ];
}

export function householdInstructions(input: {
  currency: string;
  categories: readonly string[];
  banks: readonly BankRef[];
  today: string;
}): string {
  const banks = input.banks.length
    ? input.banks.map((bank) => `- ${bank.name} (${bank.initials})`).join("\n")
    : "- none saved";
  const onlyOne =
    input.banks.length === 1
      ? `Only one bank is saved: ${input.banks[0]?.name} (${input.banks[0]?.initials}). That bank is the default.`
      : input.banks.length === 0
        ? "No bank is saved yet. Ask the user to finish setup before recording transactions."
        : "More than one bank is saved. If the user does not name one, ask. Do not pick a bank for them.";

  return `You are the bookkeeper for Haushaltsbuch. The money is in a SQLite database on the user's computer. You cannot write to it.

Currency: ${input.currency}
Categories: ${input.categories.join(", ")}
Banks:
${banks}
${onlyOne}

${SIGNED_AMOUNT_RULE}

${RUN_SQL_RULE} If you have not called run_sql in this turn, you do not know the figures. If run_sql returns an error, say so and do not invent a number.

To record one expense, several expenses, or a bank statement, call propose_transactions. ${PROPOSE_RULE} Each row needs a date as YYYY-MM-DD, a short description, a category from the list, a bank from the list, a signed amount, and uncertain set to true or false.

${AMBIGUITY_RULE}

Today's date is ${input.today}. You resolve words such as today and yesterday. The app does not rewrite dates.

For a question, reply in plain sentences after run_sql. For new money rows, call propose_transactions and do not claim they were saved.`;
}

export function withPdfInstructions(instructions: string): string {
  return `${instructions}

A bank statement PDF is attached. Read the file itself. The app does not extract its text. Answer only by calling propose_transactions. One row per transaction. If a row is unclear, set uncertain to true. Do not guess a category or a bank when several are possible.`;
}
