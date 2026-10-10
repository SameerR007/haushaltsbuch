export const XLSX_FILENAME = "haushaltsbuch-expenses.xlsx";
export const SQLITE_FILENAME = "haushaltsbuch.sqlite";

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

export function removeWarning(name: string, initials: string, count: number): { title: string; body: string } {
  const title = `Remove ${name} (${initials})?`;
  if (count <= 0) {
    return {
      title,
      body: "It has no transactions. You just won't see it as a choice for new entries. You can add it back any time.",
    };
  }
  if (count === 1) {
    return {
      title,
      body: "Its 1 transaction stays saved and still shows in Expenses and the Excel export. You just won't see it as a choice for new entries.",
    };
  }
  return {
    title,
    body: `Its ${count} transactions stay saved and still show in Expenses and the Excel export. You just won't see it as a choice for new entries.`,
  };
}

export function excelBackupLabel(count: number): string {
  if (count === 1) return "Excel file with all 1 expense (.xlsx)";
  return `Excel file with all ${count} expenses (.xlsx)`;
}

export function savedBankLine(name: string, initials: string): string {
  return `Saved ${name} (${initials}). Add another bank?`;
}
