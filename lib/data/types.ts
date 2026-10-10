export type BankView = {
  name: string;
  initials: string;
  active: boolean;
  removedAt: string | null;
  transactionCount: number;
};

export type HouseholdView = {
  ok: true;
  database: "on this computer";
  currency: string | null;
  currencyLabel: string | null;
  transactionCount: number;
  banks: BankView[];
};

export type TransactionView = {
  id: number;
  date: string;
  category: string;
  bank: string;
  amount: number;
  notes: string | null;
};

export type TransactionList = {
  ok: true;
  currency: string | null;
  currencyLabel: string | null;
  categories: string[];
  banks: BankView[];
  transactions: TransactionView[];
};
