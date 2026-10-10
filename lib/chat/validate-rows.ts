import type {
  BankRef,
  ExistingTxn,
  ReviewContext,
  ReviewRow,
  RowFlag,
} from "./types";

const BLOCKING = new Set<RowFlag>([
  "invalid_date",
  "invalid_amount",
  "unknown_category",
  "unknown_bank",
]);

export function rowBlocksSave(row: ReviewRow): boolean {
  return row.flags.some((flag) => BLOCKING.has(flag));
}

export function flagLabel(flag: RowFlag): string {
  switch (flag) {
    case "invalid_date":
      return "Enter a real date (YYYY-MM-DD).";
    case "invalid_amount":
      return "Enter a number. Expenses are negative, income is positive.";
    case "unknown_category":
      return "Pick a category from your list.";
    case "unknown_bank":
      return "Pick one of your banks.";
    case "duplicate":
      return "Already saved — same date, amount, bank, and description.";
    case "uncertain":
      return "Check this row before saving.";
  }
}

export function parseIsoDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseAmount(value: unknown): number | null {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null;
    numeric = Number(trimmed);
  } else {
    return null;
  }
  if (!Number.isFinite(numeric) || Math.abs(numeric) > 1_000_000_000) return null;
  return Math.round(numeric * 100) / 100;
}

export function rowsOf(args: unknown): unknown[] {
  if (typeof args !== "object" || args === null || !("rows" in args)) return [];
  const rows = (args as { rows: unknown }).rows;
  return Array.isArray(rows) ? rows.slice(0, 400) : [];
}

export function rowDuplicateKey(row: {
  date: string | null;
  amount: number | null;
  bank: string;
  description: string;
}): string | null {
  if (!row.date || row.amount === null || !row.bank) return null;
  return `${row.date}|${Math.round(row.amount * 100)}|${row.bank}|${row.description.trim()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function matchName(input: string, names: readonly string[]): string | null {
  return names.find((name) => name.toLowerCase() === input.toLowerCase()) ?? null;
}

function resolveBank(
  input: string,
  banks: readonly BankRef[],
): { kind: "matched" | "default"; bank: BankRef } | { kind: "unknown" } {
  const match = banks.find((bank) => bank.name.toLowerCase() === input.toLowerCase());
  if (match) return { kind: "matched", bank: match };
  if (banks.length === 1 && banks[0]) return { kind: "default", bank: banks[0] };
  return { kind: "unknown" };
}

function findDuplicate(
  row: { date: string; amount: number; bank: string; description: string },
  existing: readonly ExistingTxn[],
): ExistingTxn | undefined {
  const cents = Math.round(row.amount * 100);
  return existing.find(
    (saved) =>
      saved.date === row.date &&
      saved.bank === row.bank &&
      saved.notes === row.description &&
      Math.round(saved.amount * 100) === cents,
  );
}

export function reviewProposedRows(rawRows: unknown, context: ReviewContext): ReviewRow[] {
  if (!Array.isArray(rawRows)) return [];
  return rawRows.slice(0, 400).map((raw) => reviewOne(raw, context));
}

function reviewOne(raw: unknown, context: ReviewContext): ReviewRow {
  const record = asRecord(raw);
  const dateInput = typeof record.date === "string" ? record.date.trim() : "";
  const description = (typeof record.description === "string" ? record.description : "")
    .trim()
    .slice(0, 500);
  const categoryInput = typeof record.category === "string" ? record.category.trim() : "";
  const bankInput = typeof record.bank === "string" ? record.bank.trim() : "";
  const date = dateInput ? parseIsoDate(dateInput) : null;
  const amount = parseAmount(record.amount);
  const flags: RowFlag[] = [];

  if (!date) flags.push("invalid_date");
  if (amount === null) flags.push("invalid_amount");

  const category = matchName(categoryInput, context.categories);
  if (!category) flags.push("unknown_category");

  const resolved = resolveBank(bankInput, context.banks);
  let bank = bankInput;
  let bankInitials: string | null = null;
  if (resolved.kind === "unknown") {
    flags.push("unknown_bank");
  } else {
    bank = resolved.bank.name;
    bankInitials = resolved.bank.initials;
    if (resolved.kind === "default" && bankInput && bankInput.toLowerCase() !== resolved.bank.name.toLowerCase()) {
      flags.push("uncertain");
    }
  }

  let duplicateOf: number | null = null;
  if (date && amount !== null && bank && !flags.includes("unknown_bank")) {
    const found = findDuplicate({ date, amount, bank, description }, context.existing);
    if (found) {
      duplicateOf = found.id;
      flags.push("duplicate");
    }
  }

  if (record.uncertain === true && !flags.includes("uncertain")) flags.push("uncertain");

  const row: ReviewRow = {
    date,
    dateInput,
    description,
    category: category ?? categoryInput,
    bank,
    bankInitials,
    amount,
    amountInput:
      amount === null
        ? typeof record.amount === "string"
          ? record.amount
          : ""
        : String(amount),
    flags,
    duplicateOf,
    duplicateKey: null,
  };
  row.duplicateKey = duplicateOf !== null ? rowDuplicateKey(row) : null;
  return row;
}

/** Re-check a row the user edited. Duplicate status stays only when the key still matches. */
export function revalidateRow(row: ReviewRow, context: ReviewContext): ReviewRow {
  const [reviewed] = reviewProposedRows(
    [
      {
        date: row.dateInput,
        description: row.description,
        category: row.category,
        bank: row.bank,
        amount: row.amountInput,
        uncertain: false,
      },
    ],
    { ...context, existing: [] },
  );
  if (!reviewed) return row;
  const key = rowDuplicateKey(reviewed);
  if (row.duplicateKey && key === row.duplicateKey) {
    return {
      ...reviewed,
      flags: reviewed.flags.includes("duplicate")
        ? reviewed.flags
        : [...reviewed.flags, "duplicate"],
      duplicateOf: row.duplicateOf,
      duplicateKey: row.duplicateKey,
    };
  }
  return { ...reviewed, duplicateOf: null, duplicateKey: null };
}
