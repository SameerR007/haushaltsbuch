export const XLSX_FILENAME = "haushaltsbuch-expenses.xlsx";
export const SQLITE_FILENAME = "haushaltsbuch.sqlite";

export const EXPENSES_EMPTY_LEAD =
  "Here you will see all your expenses once you have added some. Go to Chat to add your first expense, or import a bank statement PDF.";
export const EXPENSES_EMPTY_NOTE =
  "Your expenses stay saved on this computer between openings of the app, unless you choose to set up completely new.";
export const EXPENSES_EMPTY_ACTION = "Go to Chat";

/** Excel download is for a sheet that already has rows. */
export function showExpensesDownload(rowCount: number): boolean {
  return rowCount > 0;
}

export function transactionCountLabel(count: number): string {
  if (count <= 0) return "no transactions";
  if (count === 1) return "1 transaction";
  return `${count} transactions`;
}

export function keptCountLabel(count: number): string {
  if (count <= 0) return "no transactions kept";
  if (count === 1) return "1 transaction kept";
  return `${count} transactions kept`;
}

export function xlsxSavedLine(count: number): string {
  const expenses = count === 1 ? "1 expense" : `${count} expenses`;
  return `${XLSX_FILENAME} — ${expenses}`;
}

export function sqliteSavedLine(): string {
  return `${SQLITE_FILENAME} — raw database`;
}

export function removeWarning(
  name: string,
  initials: string,
  count: number,
): { title: string; body: string; emphasis: string | null } {
  const title = `Remove ${name} (${initials})?`;
  if (count <= 0) {
    return {
      title,
      emphasis: null,
      body: "It has no transactions. You just won't see it as a choice for new entries. You can add it back any time.",
    };
  }
  const emphasis = count === 1 ? "1 transaction" : `${count} transactions`;
  const verb = count === 1 ? "stays" : "stay";
  return {
    title,
    emphasis,
    body: `Its ${emphasis} ${verb} saved and still show in Expenses and the Excel export. You just won't see it as a choice for new entries.`,
  };
}

export function excelBackupLabel(count: number): string {
  if (count === 1) return "Excel file with all 1 expense (.xlsx)";
  return `Excel file with all ${count} expenses (.xlsx)`;
}

export function savedBankLine(name: string, initials: string): string {
  return `Saved ${name} (${initials}). Add another bank?`;
}
