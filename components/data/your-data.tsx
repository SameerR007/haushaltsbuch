"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TRACKER_HOME } from "@/components/tracker/nav";
import {
  assistantSummary,
  assistantUsesKey,
  readConnection,
  rememberActiveBanks,
  type AssistantSettings,
} from "@/lib/connection";
import { parseHousehold } from "@/lib/data/parse";
import type { HouseholdView } from "@/lib/data/types";

export function YourData({ updated }: { updated: boolean }) {
  const [household, setHousehold] = useState<HouseholdView | null>(null);
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setAssistant(readConnection()?.assistant ?? null);
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/household");
        const household = parseHousehold(await response.json());
        if (!response.ok || !household) throw new Error("unread");
        if (ignore) return;
        rememberActiveBanks(household);
        setAssistant(readConnection()?.assistant ?? null);
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
  const keyLine =
    assistant?.type === "local"
      ? "not needed"
      : assistant
        ? "saved in this browser"
        : "not saved in this browser";
  const keyLabel = assistant?.type === "endpoint" ? "API key" : "OpenAI key";

  return (
    <main className="data-card">
      <p className="data-lead is-strong">Here&apos;s what&apos;s saved. Money stays on this computer.</p>
      {updated ? <p className="data-notice">Banks updated. Here&apos;s what&apos;s saved now.</p> : null}
      {error ? (
        <p className="data-error" role="alert">
          {error}
        </p>
      ) : null}
      <dl className="data-rows">
        <div>
          <dt>Database</dt>
          <dd>on this computer</dd>
        </div>
        <div>
          <dt>Assistant</dt>
          <dd>{assistant ? assistantSummary(assistant) : "not saved"}</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd>{household?.currencyLabel ?? (household ? "not saved" : "…")}</dd>
        </div>
        <div>
          <dt>Banks</dt>
          <dd>{household ? bankLine : "…"}</dd>
        </div>
        <div>
          <dt>{keyLabel}</dt>
          <dd>{keyLine}</dd>
        </div>
      </dl>
      <div className="data-action-row">
        <Link className="data-primary" href={TRACKER_HOME}>
          Open tracker
        </Link>
        {assistant && assistantUsesKey(assistant) ? (
          <Link className="data-secondary" href="/setup?mode=keys">
            Change keys
          </Link>
        ) : null}
        <Link className="data-secondary" href="/data/assistant">
          Change assistant
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
