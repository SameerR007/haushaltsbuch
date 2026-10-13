"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function stepLabel(path: string): string {
  if (path.startsWith("/data/assistant")) return "CHANGE ASSISTANT";
  if (path.startsWith("/data/banks")) return "ADD / REMOVE BANKS";
  if (path.startsWith("/data/reset")) return "SET UP COMPLETELY NEW";
  return "YOUR DATA";
}

export function DataChrome({ children }: { children: ReactNode }) {
  const path = usePathname() || "/data";
  const back = path === "/data" ? "/" : "/data";
  return (
    <div className="data-root">
      <header className="data-header">
        <Link className="data-brand" href="/">
          Haushaltsbuch
        </Link>
        <div className="data-tools">
          <Link className="data-header-back" href={back}>
            ← Back
          </Link>
          <span className="data-step">{stepLabel(path)}</span>
        </div>
      </header>
      <div className="data-body">{children}</div>
    </div>
  );
}
