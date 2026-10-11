import type { Metadata } from "next";
import { Suspense } from "react";
import { SummaryBoard } from "@/components/tracker/summary-board";

export const metadata: Metadata = {
  title: "Summary · Haushaltsbuch",
};

export default function SummaryPage() {
  return (
    <Suspense fallback={<main className="summary"><p className="summary-status">Loading summary…</p></main>}>
      <SummaryBoard />
    </Suspense>
  );
}
