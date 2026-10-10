import type { Metadata } from "next";
import { ExpensesBoard } from "@/components/tracker/expenses-board";

export const metadata: Metadata = {
  title: "Expenses · Haushaltsbuch",
};

export default function ExpensesPage() {
  return <ExpensesBoard />;
}
