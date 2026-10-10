"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TrackerHeader() {
  const pathname = usePathname();
  const chat = pathname === "/app";
  const expenses = pathname.startsWith("/app/expenses");
  const insights = pathname.startsWith("/app/insights");
  const summary = pathname.startsWith("/app/summary");

  return (
    <header className="tracker-header">
      <Link className="tracker-brand" href="/">
        Haushaltsbuch
      </Link>
      <nav className="tracker-nav" aria-label="Tracker">
        <Link className={chat ? "is-active" : undefined} href="/app">
          Chat
        </Link>
        <Link className={expenses ? "is-active" : undefined} href="/app/expenses">
          Expenses
        </Link>
        <a
          className={insights ? "is-active" : undefined}
          href="/app/insights"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Insights, opens in a new window"
        >
          Insights ↗
        </a>
        <Link className={summary ? "is-active" : undefined} href="/app/summary">
          Summary
        </Link>
      </nav>
    </header>
  );
}
