export type SummaryRow = {
  id: number;
  date: string;
  category: string;
  bank: string;
  bankInitials: string | null;
  amount: number;
  notes: string | null;
};

export type SummaryCategory = {
  category: string;
  amount: number;
};

export type SummaryPayload = {
  ok: true;
  currency: string | null;
  currencyLabel: string | null;
  from: string | null;
  to: string | null;
  compareFrom: string | null;
  compareTo: string | null;
  latestFrom: string | null;
  latestTo: string | null;
  income: number;
  expenses: number;
  net: number;
  compareIncome: number;
  compareExpenses: number;
  compareNet: number;
  categories: SummaryCategory[];
  compareCategories: SummaryCategory[];
  incomeRows: SummaryRow[];
  largest: SummaryRow[];
};
