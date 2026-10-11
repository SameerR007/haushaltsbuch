"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearConnection } from "@/lib/connection";
import { excelBackupLabel, sqliteSavedLine, SQLITE_FILENAME, xlsxSavedLine, XLSX_FILENAME } from "@/lib/data/copy";
import { parseHousehold } from "@/lib/data/parse";

async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function StartOver() {
  const router = useRouter();
  const [phase, setPhase] = useState<"backup" | "confirm">("backup");
  const [count, setCount] = useState(0);
  const [wantXlsx, setWantXlsx] = useState(true);
  const [wantSqlite, setWantSqlite] = useState(false);
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/household");
        const household = parseHousehold(await response.json());
        if (!ignore && household) setCount(household.transactionCount);
      } catch {
        if (!ignore) setCount(0);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  async function onDownload() {
    if (busy) return;
    if (!wantXlsx && !wantSqlite) {
      setError("Choose a backup to download, or skip.");
      return;
    }
    setBusy(true);
    setError("");
    const saved: string[] = [];
    try {
      if (wantXlsx) {
        await downloadFile("/api/export/xlsx", XLSX_FILENAME);
        saved.push(xlsxSavedLine(count));
      }
      if (wantSqlite) {
        await downloadFile("/api/export/sqlite", SQLITE_FILENAME);
        saved.push(sqliteSavedLine());
      }
      setDownloaded(saved);
      setPhase("confirm");
    } catch {
      setError("Could not download the backup.");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data: unknown = await response.json();
      const ok = typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;
      if (!response.ok || !ok) {
        const message =
          typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Could not delete the saved data.";
        setError(message);
        return;
      }
      clearConnection();
      router.push("/setup");
    } catch {
      setError("Could not delete the saved data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="data-card">
      <p className="data-steps" aria-label="Steps">
        <span className={phase === "backup" ? "is-now" : undefined}>1 WARNING</span>
        {" → "}
        <span className={phase === "backup" ? "is-now" : undefined}>2 BACKUP</span>
        {" → "}
        <span className={phase === "confirm" ? "is-now" : undefined}>3 CONFIRM</span>
      </p>

      {phase === "backup" ? (
        <>
          <h1>Before you start over, save a backup?</h1>
          <p className="data-lead">
            Starting over deletes <strong>all your saved expenses</strong>, banks, currency and the OpenAI
            key in this browser. It can&apos;t be undone.
          </p>
          <label className="data-check">
            <input type="checkbox" checked={wantXlsx} onChange={(event) => setWantXlsx(event.target.checked)} />
            <span>{excelBackupLabel(count)}</span>
          </label>
          <label className="data-check">
            <input
              type="checkbox"
              checked={wantSqlite}
              onChange={(event) => setWantSqlite(event.target.checked)}
            />
            <span>Also the raw database file (.sqlite) — for advanced use</span>
          </label>
          <div className="data-stack data-gap">
            <button type="button" className="data-primary" disabled={busy || (!wantXlsx && !wantSqlite)} onClick={() => void onDownload()}>
              {busy ? "Downloading…" : "Download backup"}
            </button>
            <button
              type="button"
              className="data-secondary"
              disabled={busy}
              onClick={() => {
                setDownloaded([]);
                setError("");
                setPhase("confirm");
              }}
            >
              Skip backup
            </button>
            <Link className="data-secondary" href="/data">
              Cancel
            </Link>
          </div>
          <p className="data-note">Backups go to your Downloads folder. Nothing is deleted yet.</p>
        </>
      ) : (
        <>
          {downloaded.length > 0 ? (
            <>
              <p className="data-lead is-strong">Backup saved.</p>
              <ul className="data-files">
                {downloaded.map((name) => (
                  <li key={name}>✓ {name}</li>
                ))}
              </ul>
            </>
          ) : null}
          <h1>Last step</h1>
          <p className="data-lead">
            This now deletes everything in the app and starts setup again from the OpenAI key.
            {downloaded.length > 0 ? " Your downloaded backup files stay in your Downloads folder." : ""}
          </p>
          <div className="data-stack data-gap">
            <button type="button" className="data-danger" disabled={busy} onClick={() => void onReset()}>
              {busy ? "Deleting…" : "Yes, delete everything and start over"}
            </button>
            <Link className="data-primary" href="/data">
              Keep my data
            </Link>
          </div>
        </>
      )}
      {error ? (
        <p className="data-error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
