import type { Metadata } from "next";
import { ExpensesBoard } from "@/components/tracker/expenses-board";

export const metadata: Metadata = {
  title: "Expenses · Haushaltsbuch",
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const params = await searchParams;
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  return <ExpensesBoard focusId={focus ?? null} />;
}
