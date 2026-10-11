"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { rememberActiveBanks } from "@/lib/connection";
import { keptCountLabel, removeWarning, savedBankLine, transactionCountLabel } from "@/lib/data/copy";
import { parseHousehold } from "@/lib/data/parse";
import type { BankView, HouseholdView } from "@/lib/data/types";
import { suggestInitials } from "@/lib/setup/chat-logic";

const THATS_ALL = "That’s all";

function WarningText({ body, emphasis }: { body: string; emphasis: string | null }) {
  if (!emphasis) return body;
  const index = body.indexOf(emphasis);
  if (index < 0) return body;
  return (
    <>
      {body.slice(0, index)}
      <strong>{emphasis}</strong>
      {body.slice(index + emphasis.length)}
    </>
  );
}

async function postJson(path: string, body: object): Promise<{ ok: boolean; error?: string; bank?: BankView; alreadyActive?: boolean }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null) return { ok: false, error: "Unexpected response." };
  const row = data as { ok?: unknown; error?: unknown; bank?: unknown; alreadyActive?: unknown };
  const bank = row.bank && typeof row.bank === "object" ? (row.bank as BankView) : undefined;
  return {
    ok: row.ok === true && response.ok,
    error: typeof row.error === "string" ? row.error : undefined,
    bank,
    alreadyActive: row.alreadyActive === true,
  };
}

export function BankManager() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [household, setHousehold] = useState<HouseholdView | null>(null);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<BankView | null>(null);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedLine, setSavedLine] = useState("");
  const [changed, setChanged] = useState(false);

  async function load() {
    const response = await fetch("/api/household");
    const household = parseHousehold(await response.json());
    if (!response.ok || !household) throw new Error("unread");
    rememberActiveBanks(household);
    setHousehold(household);
  }

  useEffect(() => {
    let ignore = false;
    void load().catch(() => {
      if (!ignore) setError("Could not read the database on this computer.");
    });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pendingRemove && !dialog.open) dialog.showModal();
    if (!pendingRemove && dialog.open) dialog.close();
  }, [pendingRemove]);

  const active = household?.banks.filter((bank) => bank.active) ?? [];
  const removed = household?.banks.filter((bank) => !bank.active) ?? [];
  const lastBank = active.length === 1;
  const warning = pendingRemove
    ? removeWarning(pendingRemove.name, pendingRemove.initials, pendingRemove.transactionCount)
    : null;

  async function onRemove() {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    setError("");
    try {
      const result = await postJson("/api/banks/remove", { name: pendingRemove.name });
      if (!result.ok) {
        setError(result.error ?? "Could not remove that bank.");
        return;
      }
      setPendingRemove(null);
      setChanged(true);
      await load();
    } catch {
      setError("Could not remove that bank.");
    } finally {
      setRemoving(false);
    }
  }

  async function onRestore(bank: BankView) {
    setError("");
    try {
      const result = await postJson("/api/banks/restore", { name: bank.name });
      if (!result.ok) {
        setError(result.error ?? "Could not add that bank back.");
        return;
      }
      setChanged(true);
      await load();
    } catch {
      setError("Could not add that bank back.");
    }
  }

  async function onSaveBank(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await postJson("/api/banks", { name, initials });
      if (!result.ok || !result.bank) {
        setError(result.error ?? "Could not add that bank.");
        return;
      }
      const line = result.alreadyActive
        ? `${result.bank.name} (${result.bank.initials}) is already one of your banks. Add another bank?`
        : savedBankLine(result.bank.name, result.bank.initials);
      setSavedLine(line);
      setName("");
      setInitials("");
      setInitialsTouched(false);
      setChanged(true);
      await load();
    } catch {
      setError("Could not add that bank.");
    } finally {
      setSaving(false);
    }
  }

  function addAnother() {
    setSavedLine("");
    setError("");
  }

  return (
    <main className="data-card">
      <h1>Add / Remove banks</h1>
      <section className="data-panel" aria-label="Your banks">
        <p>Your banks. Tap the minus to remove one.</p>
        {active.length === 0 ? <p className="data-muted">No banks yet.</p> : null}
        {active.map((bank) => (
          <div className="bank-row" key={bank.name}>
            <button
              type="button"
              className="bank-minus"
              aria-label={`Remove ${bank.name} (${bank.initials})`}
              disabled={lastBank}
              onClick={() => setPendingRemove(bank)}
            >
              −
            </button>
            <span>
              <strong>{bank.name}</strong> ({bank.initials})
            </span>
            <span className="bank-count">{transactionCountLabel(bank.transactionCount)}</span>
          </div>
        ))}
        {lastBank ? <p className="bank-keep">Keep at least one bank.</p> : null}
      </section>

      {removed.length > 0 ? (
        <section className="data-removed" aria-label="Removed banks">
          <h2>REMOVED BANKS</h2>
          {removed.map((bank) => (
            <div className="removed-row" key={bank.name}>
              <span>
                <strong>{bank.name}</strong> ({bank.initials})
              </span>
              <span>{keptCountLabel(bank.transactionCount)}</span>
              <button type="button" className="data-chip" onClick={() => void onRestore(bank)}>
                Add back
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="data-panel" aria-label="Add a bank">
        {savedLine ? (
          <div>
            <p>{savedLine}</p>
            <div className="data-chips">
              <button type="button" className="data-chip primary" onClick={addAnother}>
                Add another bank
              </button>
              <button type="button" className="data-chip" onClick={() => router.push("/data?updated=1")}>
                {THATS_ALL}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void onSaveBank(event)}>
            <h2>Add a bank — name and initials</h2>
            <label className="data-field">
              Bank name
              <input
                value={name}
                autoComplete="off"
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!initialsTouched) setInitials(suggestInitials(value));
                }}
              />
            </label>
            <label className="data-field">
              Initials
              <input
                value={initials}
                autoComplete="off"
                spellCheck={false}
                maxLength={4}
                onChange={(event) => {
                  setInitialsTouched(true);
                  setInitials(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4));
                }}
              />
            </label>
            <div className="data-chips">
              <button className="data-chip primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save bank"}
              </button>
            </div>
          </form>
        )}
      </section>
      {error ? (
        <p className="data-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="data-done">
        <Link className="data-primary" href={changed ? "/data?updated=1" : "/data"}>
          Done
        </Link>
      </div>

      <dialog className="data-dialog" ref={dialogRef} onClose={() => setPendingRemove(null)}>
        {warning ? (
          <>
            <h2>{warning.title}</h2>
            <p>
              <WarningText body={warning.body} emphasis={warning.emphasis} />
            </p>
            <div className="data-dialog-actions">
              <button type="button" className="data-secondary" onClick={() => setPendingRemove(null)} autoFocus>
                Cancel
              </button>
              <button type="button" className="data-danger" disabled={removing} onClick={() => void onRemove()}>
                Remove bank
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </main>
  );
}
