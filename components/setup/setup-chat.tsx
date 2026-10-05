"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  readConnection,
  writeConnection,
  type SavedBank,
  type SavedConnection,
} from "@/lib/connection";
import {
  currencyChoiceLabel,
  looksLikeSecret,
  normalizeBank,
  parseCurrencyText,
  suggestInitials,
} from "@/lib/setup/chat-logic";

type Phase =
  | "boot"
  | "saved"
  | "openai"
  | "currency"
  | "banks"
  | "bank"
  | "bank-next"
  | "confirm"
  | "done"
  | "keys";

type Widget =
  | "openai"
  | "currency"
  | "banks"
  | "bank"
  | "bank-next"
  | "confirm"
  | "done"
  | "keys"
  | "saved";

type Rich = "welcome" | "next" | "tables" | "currency";

type Msg = {
  id: number;
  from: "bot" | "user";
  text?: string;
  rich?: Rich;
  faded?: boolean;
  widget?: Widget;
};

type ApiBody = {
  ok?: unknown;
  error?: unknown;
  code?: unknown;
};

const EMPTY_CONNECTION_NOTE = "Use the fields in the chat for keys.";

function stepLabel(phase: Phase): string {
  if (phase === "saved") return "Setup · saved";
  if (phase === "keys") return "Setup · keys";
  if (phase === "boot") return "Setup";
  if (phase === "openai") return "Setup · step 1 of 3";
  if (
    phase === "currency" ||
    phase === "banks" ||
    phase === "bank" ||
    phase === "bank-next"
  ) {
    return "Setup · step 2 of 3";
  }
  return "Setup · step 3 of 3";
}

async function postJson(
  path: string,
  body: object,
): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null || !("ok" in data)) {
      return { ok: false, error: "Unexpected response from setup." };
    }
    const row = data as ApiBody;
    return {
      ok: row.ok === true,
      error: typeof row.error === "string" ? row.error : undefined,
      code: typeof row.code === "string" ? row.code : undefined,
    };
  } catch {
    return { ok: false, error: "Could not reach the setup service." };
  }
}

function bankList(banks: SavedBank[]): string {
  return banks.map((bank) => `${bank.name} (${bank.initials})`).join(", ");
}

function freshThread(nid: () => number): Msg[] {
  return [
    { id: nid(), from: "bot", rich: "welcome" },
    { id: nid(), from: "bot", widget: "openai" },
    { id: nid(), from: "bot", rich: "next", faded: true },
  ];
}

export function SetupChat() {
  const idRef = useRef(100);
  const threadRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [openai, setOpenai] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [banks, setBanks] = useState<SavedBank[]>([]);
  const [many, setMany] = useState(false);
  const [bankName, setBankName] = useState("");
  const [bankInitials, setBankInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [customCurrency, setCustomCurrency] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [draft, setDraft] = useState("");

  function nid() {
    idRef.current += 1;
    return idRef.current;
  }

  function persist(connection: SavedConnection): boolean {
    try {
      writeConnection(connection);
      return true;
    } catch {
      setFormError("Could not save keys in this browser.");
      return false;
    }
  }

  async function ensureInit(): Promise<boolean> {
    const result = await postJson("/api/setup/init", {});
    if (!result.ok) {
      setFormError(result.error ?? "Could not prepare the local database.");
      return false;
    }
    return true;
  }

  function showOpenAiStep() {
    setFormError("");
    setPhase("openai");
    setMessages(freshThread(nid));
  }

  function showSaved(connection: SavedConnection) {
    setSaved(connection);
    setCurrency(connection.currency);
    setBanks(connection.banks);
    setOpenai("");
    setFormError("");
    setPhase("saved");
    setMessages([{ id: nid(), from: "bot", widget: "saved" }]);
  }

  function showCurrencyStep() {
    setFormError("");
    setShowOther(false);
    setPhase("currency");
    setMessages([
      { id: nid(), from: "bot", rich: "tables" },
      { id: nid(), from: "bot", widget: "currency" },
    ]);
  }

  useEffect(() => {
    let ignore = false;
    const existing = readConnection();
    if (existing) {
      setSaved(existing);
      setCurrency(existing.currency);
      setBanks(existing.banks);
      setPhase("saved");
      setMessages([{ id: 1, from: "bot", widget: "saved" }]);
    } else {
      setPhase("openai");
      setMessages([
        { id: 1, from: "bot", rich: "welcome" },
        { id: 2, from: "bot", widget: "openai" },
        { id: 3, from: "bot", rich: "next", faded: true },
      ]);
    }
    void (async () => {
      const result = await postJson("/api/setup/init", {});
      if (ignore || result.ok) return;
      setFormError(result.error ?? "Could not prepare the local database.");
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, phase, formError]);

  function startChangeKeys() {
    setFormError("");
    setOpenai("");
    if (saved) {
      setPhase("keys");
      setMessages([{ id: nid(), from: "bot", widget: "keys" }]);
      return;
    }
    showOpenAiStep();
  }

  async function setUpAgain() {
    setOpenai("");
    setCurrency("EUR");
    setBanks([]);
    setBankName("");
    setBankInitials("");
    setInitialsTouched(false);
    setMany(false);
    setShowOther(false);
    setCustomCurrency("");
    setDraft("");
    setFormError("");
    setPhase("openai");
    setMessages(freshThread(nid));
    setPending(true);
    try {
      await ensureInit();
    } finally {
      setPending(false);
    }
  }

  async function onOpenAi(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormError("");
    setPending(true);
    try {
      const ready = await ensureInit();
      if (!ready) return;
      const result = await postJson("/api/setup/openai", { apiKey: openai.trim() });
      if (!result.ok) {
        setFormError(result.error ?? "Could not check that key.");
        return;
      }
      showCurrencyStep();
    } finally {
      setPending(false);
    }
  }

  function chooseCurrency(code: string) {
    if (pending || phase !== "currency") return;
    setCurrency(code);
    setShowOther(false);
    setFormError("");
    setPhase("banks");
    const userId = nid();
    const botId = nid();
    setMessages((prev) => [
      ...prev,
      { id: userId, from: "user", text: currencyChoiceLabel(code) },
      { id: botId, from: "bot", widget: "banks" },
    ]);
  }

  function onOther(event: FormEvent) {
    event.preventDefault();
    const code = parseCurrencyText(customCurrency);
    if (!code) {
      setFormError("Enter a 3-letter currency code.");
      return;
    }
    chooseCurrency(code);
  }

  function chooseBankCount(manyBanks: boolean) {
    if (phase !== "banks") return;
    setMany(manyBanks);
    setBankName("");
    setBankInitials("");
    setInitialsTouched(false);
    setFormError("");
    setPhase("bank");
    const userId = nid();
    const botId = nid();
    setMessages((prev) => [
      ...prev,
      { id: userId, from: "user", text: manyBanks ? "More than one" : "One bank" },
      { id: botId, from: "bot", widget: "bank" },
    ]);
  }

  function goConfirm(list: SavedBank[]) {
    setBanks(list);
    setPhase("confirm");
    const id = nid();
    setMessages((prev) => [...prev, { id, from: "bot", widget: "confirm" }]);
  }

  function onSaveBank(event: FormEvent) {
    event.preventDefault();
    if (phase !== "bank") return;
    const bank = normalizeBank(bankName, bankInitials);
    if (!bank) {
      setFormError("Enter a bank name and initials (1–4 letters).");
      return;
    }
    setFormError("");
    const nextBanks = [...banks.filter((item) => item.name !== bank.name), bank];
    setBanks(nextBanks);
    setBankName("");
    setBankInitials("");
    setInitialsTouched(false);
    if (many) {
      setPhase("bank-next");
      const userId = nid();
      const botId = nid();
      setMessages((prev) => [
        ...prev,
        { id: userId, from: "user", text: `${bank.name} (${bank.initials})` },
        { id: botId, from: "bot", widget: "bank-next" },
      ]);
      return;
    }
    goConfirm(nextBanks);
  }

  function addAnother() {
    setFormError("");
    setPhase("bank");
    const id = nid();
    setMessages((prev) => [...prev, { id, from: "bot", widget: "bank" }]);
  }

  function finishBanks() {
    if (banks.length === 0) {
      setFormError("Add at least one bank.");
      return;
    }
    setFormError("");
    goConfirm(banks);
  }

  async function onConfirm() {
    if (pending || phase !== "confirm") return;
    setFormError("");
    setPending(true);
    const savedBanks = banks;
    const apiKey = openai.trim();
    try {
      const result = await postJson("/api/setup/confirm", {
        currency,
        banks: savedBanks,
      });
      if (!result.ok) {
        setFormError(result.error ?? "Could not save currency and banks.");
        return;
      }
      const connection: SavedConnection = {
        v: 2,
        openaiApiKey: apiKey,
        currency,
        banks: savedBanks,
      };
      if (!persist(connection)) return;
      setSaved(connection);
      setOpenai("");
      setPhase("done");
      const userId = nid();
      const botId = nid();
      setMessages((prev) => [
        ...prev,
        { id: userId, from: "user", text: "Confirm" },
        { id: botId, from: "bot", widget: "done" },
      ]);
    } finally {
      setPending(false);
    }
  }

  async function onSaveKeys(event: FormEvent) {
    event.preventDefault();
    if (!saved || pending) return;
    setFormError("");
    const nextOpenAi = openai.trim() || saved.openaiApiKey;
    setPending(true);
    try {
      const result = await postJson("/api/setup/openai", { apiKey: nextOpenAi });
      if (!result.ok) {
        setFormError(result.error ?? "Could not check the OpenAI key.");
        return;
      }
      const connection: SavedConnection = {
        v: 2,
        openaiApiKey: nextOpenAi,
        currency: saved.currency,
        banks: saved.banks,
      };
      if (!persist(connection)) return;
      showSaved(connection);
    } finally {
      setPending(false);
    }
  }

  function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    if (looksLikeSecret(text)) {
      setFormError(EMPTY_CONNECTION_NOTE);
      return;
    }
    if (phase === "currency") {
      const code = parseCurrencyText(text);
      if (!code) {
        setFormError("Choose euro, USD, GBP, or a 3-letter code.");
        return;
      }
      chooseCurrency(code);
      return;
    }
    if (phase === "banks") {
      if (/^one\b/i.test(text)) {
        chooseBankCount(false);
        return;
      }
      if (/\b(more|several|many)\b/i.test(text)) {
        chooseBankCount(true);
        return;
      }
    }
    if (phase === "bank") {
      setBankName(text);
      if (!initialsTouched) setBankInitials(suggestInitials(text));
      return;
    }
    setFormError("Use the choices in the chat.");
  }

  const activeWidgetId = [...messages].reverse().find((message) => message.widget)?.id;
  const showComposer = phase !== "boot";

  function renderRich(rich: Rich) {
    if (rich === "welcome") {
      return (
        <>
          Welcome — your money stays in a database on this computer. You’ll need an{" "}
          <strong>OpenAI API key</strong>. We check it once and keep it in this browser.
        </>
      );
    }
    if (rich === "next") {
      return (
        <>
          Next: pick currency (default €) → banks → confirm. No cloud database to connect.
        </>
      );
    }
    if (rich === "tables") {
      return (
        <>
          Tables are ready with default categories: food, rent, household, grocery,
          bill, miscellaneous, salary.
        </>
      );
    }
    return (
      <>
        What currency should we use? Default is <strong>euro (€)</strong>.
      </>
    );
  }

  function renderWidget(message: Msg) {
    const locked = message.id !== activeWidgetId;
    const busy = pending || locked;
    if (message.widget === "openai") {
      return (
        <form onSubmit={(event) => void onOpenAi(event)} data-testid="openai-form">
          <p>
            Paste your <strong>OpenAI API key</strong>. We ask once and keep it in this
            browser.
          </p>
          <div className="setup-field">
            <label htmlFor="openai-key">OpenAI API key</label>
            <input
              id="openai-key"
              name="hb-openai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              value={locked ? "" : openai}
              disabled={busy}
              onChange={(event) => setOpenai(event.target.value)}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={busy}>
              {pending && !locked ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
      );
    }
    if (message.widget === "currency") {
      return (
        <div>
          {renderRich("currency")}
          <div className="setup-chips">
            {(
              [
                ["EUR", "Keep euro (€)"],
                ["USD", "USD ($)"],
                ["GBP", "GBP (£)"],
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                className={currency === code ? "setup-chip primary" : "setup-chip"}
                disabled={busy}
                onClick={() => chooseCurrency(code)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="setup-chip"
              disabled={busy}
              onClick={() => setShowOther(true)}
            >
              Other…
            </button>
          </div>
          {showOther && !locked ? (
            <form onSubmit={onOther}>
              <div className="setup-field">
                <label htmlFor="currency-code">Currency code</label>
                <input
                  id="currency-code"
                  value={customCurrency}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="CHF"
                  disabled={pending}
                  onChange={(event) => setCustomCurrency(event.target.value)}
                />
              </div>
              <div className="setup-chips">
                <button className="setup-chip primary" type="submit" disabled={pending}>
                  Use this currency
                </button>
              </div>
            </form>
          ) : null}
        </div>
      );
    }
    if (message.widget === "banks") {
      return (
        <div>
          <p>Do you use one bank or more than one?</p>
          <div className="setup-chips">
            <button
              type="button"
              className="setup-chip primary"
              disabled={busy}
              onClick={() => chooseBankCount(false)}
            >
              One bank
            </button>
            <button
              type="button"
              className="setup-chip"
              disabled={busy}
              onClick={() => chooseBankCount(true)}
            >
              More than one
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "bank") {
      const lead =
        many && banks.length > 0
          ? "Add another bank — name and initials."
          : many
            ? "Add the first bank — name and initials."
            : "What are the name and initials for that bank?";
      return (
        <form onSubmit={onSaveBank}>
          <p>{lead}</p>
          <div className="setup-field">
            <label htmlFor={`bank-name-${message.id}`}>Bank name</label>
            <input
              id={`bank-name-${message.id}`}
              value={locked ? "" : bankName}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value;
                setBankName(value);
                if (!initialsTouched) setBankInitials(suggestInitials(value));
              }}
            />
          </div>
          <div className="setup-field">
            <label htmlFor={`bank-initials-${message.id}`}>Initials</label>
            <input
              id={`bank-initials-${message.id}`}
              value={locked ? "" : bankInitials}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              maxLength={4}
              onChange={(event) => {
                setInitialsTouched(true);
                setBankInitials(event.target.value.toUpperCase());
              }}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={busy}>
              Save bank
            </button>
          </div>
        </form>
      );
    }
    if (message.widget === "bank-next") {
      return (
        <div>
          <p>Add another bank?</p>
          <div className="setup-chips">
            <button
              type="button"
              className="setup-chip primary"
              disabled={busy}
              onClick={addAnother}
            >
              Add another
            </button>
            <button type="button" className="setup-chip" disabled={busy} onClick={finishBanks}>
              That’s all
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "confirm") {
      return (
        <div data-testid="confirm-card">
          <p>Here’s what we’ll keep.</p>
          <ul className="setup-summary">
            <li>Database · on this computer</li>
            <li>Currency · {currencyChoiceLabel(currency)}</li>
            <li>Banks · {bankList(banks)}</li>
            <li>OpenAI key · this browser only</li>
          </ul>
          <p>You can change keys later if they expire.</p>
          <div className="setup-chips">
            <button
              type="button"
              className="setup-chip primary"
              disabled={busy}
              data-testid="confirm-setup"
              onClick={() => void onConfirm()}
            >
              {pending && !locked ? "Saving…" : "Confirm"}
            </button>
            <button type="button" className="setup-chip" disabled={busy} onClick={startChangeKeys}>
              Change keys
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "done") {
      return (
        <div>
          <p>You’re set. The welcome screen will show Open tracker.</p>
          <div className="setup-chips">
            <Link className="setup-chip primary" href="/app">
              Open tracker
            </Link>
            <Link className="setup-chip" href="/">
              Back to welcome
            </Link>
            <button type="button" className="setup-chip" onClick={startChangeKeys}>
              Change keys
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "keys" && saved) {
      return (
        <form onSubmit={(event) => void onSaveKeys(event)} data-testid="change-keys-form">
          <p>
            Update a key that expired. Leave the field blank to keep the saved OpenAI
            key.
          </p>
          <div className="setup-field">
            <label htmlFor="change-openai">OpenAI API key</label>
            <input
              id="change-openai"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Leave blank to keep the saved OpenAI key"
              value={openai}
              disabled={pending}
              onChange={(event) => setOpenai(event.target.value)}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save keys"}
            </button>
            <button
              className="setup-chip"
              type="button"
              disabled={pending}
              onClick={() => showSaved(saved)}
            >
              Cancel
            </button>
          </div>
        </form>
      );
    }
    if (message.widget === "saved" && saved) {
      return (
        <div data-testid="saved-setup">
          <p>This browser is already set up. Money stays on this computer.</p>
          <ul className="setup-summary">
            <li>Database · on this computer</li>
            <li>Currency · {currencyChoiceLabel(saved.currency)}</li>
            <li>Banks · {bankList(saved.banks)}</li>
            <li>OpenAI key · saved in this browser</li>
          </ul>
          <div className="setup-chips">
            <Link className="setup-chip primary" href="/app">
              Open tracker
            </Link>
            <button type="button" className="setup-chip" onClick={startChangeKeys}>
              Change keys
            </button>
            <button type="button" className="setup-chip" onClick={() => void setUpAgain()}>
              Set up again
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="setup-root">
      <header className="setup-header">
        <Link className="setup-brand" href="/">
          Haushaltsbuch
        </Link>
        <div className="setup-tools">
          {phase !== "boot" ? (
            <>
              <button
                type="button"
                className="setup-text-btn"
                onClick={startChangeKeys}
                disabled={pending}
              >
                Change keys
              </button>
              <button
                type="button"
                className="setup-text-btn"
                onClick={() => void setUpAgain()}
                disabled={pending}
              >
                Set up again
              </button>
            </>
          ) : null}
          <div className="setup-step" data-testid="setup-step">
            {stepLabel(phase)}
          </div>
        </div>
      </header>
      <main className="setup-shell">
        <div className="setup-thread" ref={threadRef} data-testid="setup-thread">
          {messages.map((message) =>
            message.from === "user" ? (
              <div key={message.id} className="setup-msg setup-user">
                {message.text}
              </div>
            ) : (
              <div
                key={message.id}
                className={
                  message.faded ? "setup-msg setup-bot setup-faded" : "setup-msg setup-bot"
                }
              >
                {message.rich ? renderRich(message.rich) : null}
                {message.widget ? renderWidget(message) : null}
                {!message.rich && !message.widget ? message.text : null}
              </div>
            ),
          )}
        </div>
        {showComposer ? (
          <>
            {formError ? (
              <p className="setup-error" role="alert">
                {formError}
              </p>
            ) : null}
            <form className="setup-composer" onSubmit={onSend}>
              <input
                type="text"
                value={draft}
                placeholder="Or type a message…"
                aria-label="Message"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit">Send</button>
            </form>
          </>
        ) : null}
      </main>
    </div>
  );
}
