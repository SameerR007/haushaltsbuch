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
  /** Local statement note, for example a chat-model fallback. */
  note?: string;
  /** A row the user added on the statement card. It stays editable until it is complete. */
  draft?: boolean;
};

export type ReviewContext = {
  categories: readonly string[];
  banks: readonly BankRef[];
  existing: readonly ExistingTxn[];
};

export type StatementPageStatus = "read" | "failed" | "unread" | "skipped";

export type StatementPage = {
  page: number;
  status: StatementPageStatus;
};

/**
 * What the local pipeline learned about a statement. Opening and closing are
 * set only when both were found in the text. The review card recomputes the
 * sum from the current rows.
 */
export type StatementReview = {
  account: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  pageCount: number;
  pages: StatementPage[];
  textPages: number[];
  scannedPages: number[];
  skippedPages: number[];
  failedPage: number | null;
  opening: number | null;
  closing: number | null;
};

export type Proposal = {
  sourceName: string | null;
  currency: string;
  categories: string[];
  banks: BankRef[];
  rows: ReviewRow[];
  /** Set when a statement was read on this computer. OpenAI reviews omit it. */
  statement?: StatementReview;
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
