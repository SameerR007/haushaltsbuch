"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  AssistantChoice,
  EndpointConnectionCard,
  LocalConnectionCard,
  ProbeBanner,
  type ProbeView,
} from "@/components/assistant/assistant-ui";
import { DEFAULT_LOCAL_ADDRESS, DEFAULT_LOCAL_MODEL } from "@/lib/assistant/copy";
import type { AssistantKind } from "@/lib/assistant/target";
import {
  readConnection,
  writeConnection,
  type AssistantSettings,
  type SavedConnection,
} from "@/lib/connection";

export function ChangeAssistant() {
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [kind, setKind] = useState<AssistantKind>("openai");
  const [ready, setReady] = useState<AssistantSettings | null>(null);
  const [openai, setOpenai] = useState("");
  const [pending, setPending] = useState(false);
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = readConnection();
    setSaved(existing);
    if (existing) setKind(existing.assistant.type);
  }, []);

  function select(next: AssistantKind) {
    setKind(next);
    setReady(null);
    setProbe(null);
    setError("");
  }

  async function testOpenAi(event: FormEvent) {
    event.preventDefault();
    if (!saved || pending) return;
    const apiKey = openai.trim() || (saved.assistant.type === "openai" ? saved.assistant.apiKey : "");
    setPending(true);
    setProbe(null);
    setReady(null);
    setError("");
    try {
      const response = await fetch("/api/setup/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data: unknown = await response.json();
      const row = typeof data === "object" && data !== null ? (data as { ok?: unknown; error?: unknown }) : {};
      if (row.ok !== true) {
        setProbe({
          ok: false,
          title: typeof row.error === "string" ? row.error : "Could not check that key.",
        });
        return;
      }
      setProbe({ ok: true, status: "connected", title: "Connected.", detail: "OpenAI accepted this key." });
      setReady({ type: "openai", apiKey });
    } catch {
      setProbe({ ok: false, title: "Could not reach the setup service." });
    } finally {
      setPending(false);
    }
  }

  function save() {
    if (!saved || !ready) return;
    setError("");
    try {
      writeConnection({ ...saved, assistant: ready }, { clearPdfDisclosure: false });
    } catch {
      setError("Could not save the assistant in this browser.");
      return;
    }
    window.location.assign("/data");
  }

  const localAddress = saved?.assistant.type === "local" ? saved.assistant.address : DEFAULT_LOCAL_ADDRESS;
  const localModel = saved?.assistant.type === "local" ? saved.assistant.model : DEFAULT_LOCAL_MODEL;
  const endpointUrl = saved?.assistant.type === "endpoint" ? saved.assistant.baseUrl : "";
  const endpointModel = saved?.assistant.type === "endpoint" ? saved.assistant.model : "";

  return (
    <main className="data-card assistant-change">
      <AssistantChoice value={kind} current={saved?.assistant.type ?? null} onChange={select} />
      {kind === "openai" ? (
        <form onSubmit={(event) => void testOpenAi(event)} data-testid="change-openai-form">
          <div className="setup-field">
            <label htmlFor="change-assistant-key">OpenAI API key</label>
            <input
              id="change-assistant-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={saved?.assistant.type === "openai" ? "Leave blank to test the saved key" : "sk-…"}
              value={openai}
              disabled={pending}
              onChange={(event) => {
                setOpenai(event.target.value);
                setReady(null);
                setProbe(null);
              }}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={pending}>
              {pending ? "Testing…" : "Test connection"}
            </button>
            <Link className="setup-chip" href="/data">
              Cancel
            </Link>
          </div>
          <ProbeBanner probe={probe} />
        </form>
      ) : null}
      {kind === "local" ? (
        <LocalConnectionCard
          initialAddress={localAddress}
          initialModel={localModel}
          cancelHref="/data"
          intro={false}
          showHelp={false}
          onReadyChange={(value) => setReady(value ? { type: "local", ...value } : null)}
        />
      ) : null}
      {kind === "endpoint" ? (
        <EndpointConnectionCard
          initialUrl={endpointUrl}
          initialModel={endpointModel}
          cancelHref="/data"
          intro={false}
          onReadyChange={(value) => setReady(value ? { type: "endpoint", ...value } : null)}
        />
      ) : null}
      <p className="assistant-keep">
        Your data, banks and chat history stay exactly as they are. Only the assistant changes, and only after a
        successful test.
      </p>
      {error ? (
        <p className="setup-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="setup-chips">
        <button
          type="button"
          className="setup-chip primary"
          disabled={!ready}
          data-testid="save-assistant"
          onClick={save}
        >
          Save assistant
        </button>
      </div>
    </main>
  );
}
