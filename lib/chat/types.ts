export type RowFlag =
  | "invalid_date"
  | "invalid_amount"
  | "unknown_category"
  | "unknown_bank"
  | "duplicate"
  | "uncertain";

export type BankRef = {
  name: string;
  initials: string;
};

export type ExistingTxn = {
  id: number;
  date: string;
  amount: number;
  bank: string;
  notes: string;
};

export type ReviewRow = {
  date: string | null;
  dateInput: string;
  description: string;
  category: string;
  bank: string;
  bankInitials: string | null;
  amount: number | null;
  amountInput: string;
  flags: RowFlag[];
  duplicateOf: number | null;
  duplicateKey: string | null;
  /** When true, a duplicate row is saved. Omitted or false means Confirm skips it. */
  includeDuplicate?: boolean;
};

export type ReviewContext = {
  categories: readonly string[];
  banks: readonly BankRef[];
  existing: readonly ExistingTxn[];
};

export type Proposal = {
  sourceName: string | null;
  currency: string;
  categories: string[];
  banks: BankRef[];
  rows: ReviewRow[];
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type SaveRow = {
  date: string;
  description: string;
  category: string;
  bank: string;
  amount: number;
};
