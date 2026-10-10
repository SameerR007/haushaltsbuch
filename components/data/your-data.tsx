"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONNECTION_STORAGE_KEY, hasSavedConnection, rememberActiveBanks } from "@/lib/connection";
import { parseHousehold } from "@/lib/data/parse";
import type { HouseholdView } from "@/lib/data/types";

export function YourData({ updated }: { updated: boolean }) {
  const [household, setHousehold] = useState<HouseholdView | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setKeySaved(hasSavedConnection(window.localStorage.getItem(CONNECTION_STORAGE_KEY)));
    } catch {
      setKeySaved(false);
    }
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/household");
        const household = parseHousehold(await response.json());
        if (!response.ok || !household) throw new Error("unread");
        if (ignore) return;
        rememberActiveBanks(household);
        setHousehold(household);
      } catch {
        if (!ignore) setError("Could not read the database on this computer.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const active = household?.banks.filter((bank) => bank.active) ?? [];
  const bankLine = active.length
    ? active.map((bank) => `${bank.name} (${bank.initials})`).join(", ")
    : "none saved";

  return (
    <main className="data-card">
      <Link className="data-back" href="/">
        Back
      </Link>
      <h1>Your data</h1>
      {updated ? <p className="data-notice">Banks updated. Here&apos;s what&apos;s saved now.</p> : null}
      {error ? (
        <p className="data-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="data-facts">
        <li>Database · on this computer</li>
        <li>Currency · {household?.currencyLabel ?? (household ? "not saved" : "…")}</li>
        <li>Banks · {household ? bankLine : "…"}</li>
        <li>OpenAI key · {keySaved ? "saved in this browser" : "not saved in this browser"}</li>
      </ul>
      <div className="data-actions">
        <Link className="data-primary" href="/app">
          Open tracker
        </Link>
        <Link className="data-secondary" href="/setup?mode=keys">
          Change keys
        </Link>
        <Link className="data-secondary" href="/data/banks">
          Add / Remove banks
        </Link>
      </div>
      <div className="data-reset">
        <p>Start over from scratch:</p>
        <Link className="data-danger-outline" href="/data/reset">
          Set up completely new
        </Link>
      </div>
    </main>
  );
}
