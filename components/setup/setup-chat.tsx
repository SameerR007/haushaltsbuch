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
import { projectHost } from "@/lib/setup/guards";
import { saveHousehold, schemaReady } from "@/lib/setup/household";

type Phase =
  | "boot"
  | "help"
  | "saved"
  | "connect"
  | "openai"
  | "service"
  | "sql"
  | "currency"
  | "banks"
  | "bank"
  | "bank-next"
  | "confirm"
  | "done"
  | "keys";

type Widget =
  | "connect"
  | "openai"
  | "service"
  | "sql"
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

const EMPTY_CONNECTION_NOTE =
  "Use the fields in the chat for keys.";

function stepLabel(phase: Phase): string {
  if (phase === "help") return "Setup · help";
  if (phase === "saved") return "Setup · saved";
  if (phase === "keys") return "Setup · keys";
  if (phase === "boot") return "Setup";
  if (phase === "connect") return "Setup · step 1 of 4";
  if (phase === "openai" || phase === "service" || phase === "sql") {
    return "Setup · step 2 of 4";
  }
  if (
    phase === "currency" ||
    phase === "banks" ||
    phase === "bank" ||
    phase === "bank-next"
  ) {
    return "Setup · step 3 of 4";
  }
  return "Setup · step 4 of 4";
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

export function SetupChat() {
  const idRef = useRef(100);
  const helpReturn = useRef<Phase>("connect");
  const threadRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [url, setUrl] = useState("");
  const [anon, setAnon] = useState("");
  const [openai, setOpenai] = useState("");
  const [serviceRole, setServiceRole] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [banks, setBanks] = useState<SavedBank[]>([]);
  const [many, setMany] = useState(false);
  const [bankName, setBankName] = useState("");
  const [bankInitials, setBankInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [customCurrency, setCustomCurrency] = useState("");
  const [sqlText, setSqlText] = useState("");
  const [copied, setCopied] = useState(false);
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

  function enterConnect() {
    setFormError("");
    setPhase("connect");
    setMessages([
      { id: nid(), from: "bot", rich: "welcome" },
      { id: nid(), from: "bot", widget: "connect" },
      { id: nid(), from: "bot", rich: "next", faded: true },
    ]);
  }

  function showSaved(connection: SavedConnection) {
    setSaved(connection);
    setUrl(connection.supabaseUrl);
    setCurrency(connection.currency);
    setBanks(connection.banks);
    setAnon("");
    setOpenai("");
    setServiceRole("");
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
    const existing = readConnection();
    if (existing) {
      setSaved(existing);
      setUrl(existing.supabaseUrl);
      setCurrency(existing.currency);
      setBanks(existing.banks);
      setPhase("saved");
      setMessages([{ id: 1, from: "bot", widget: "saved" }]);
      return;
    }
    setPhase("connect");
    setMessages([
      { id: 1, from: "bot", rich: "welcome" },
      { id: 2, from: "bot", widget: "connect" },
      { id: 3, from: "bot", rich: "next", faded: true },
    ]);
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, phase, formError]);

  useEffect(() => {
    if (phase !== "sql") return;
    let ignore = false;
    fetch("/api/setup/sql")
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("sql"))))
      .then((text) => {
        if (!ignore) setSqlText(text);
      })
      .catch(() => {
        if (!ignore) setSqlText("");
      });
    return () => {
      ignore = true;
    };
  }, [phase]);

  function openHelp() {
    helpReturn.current = phase;
    setFormError("");
    setPhase("help");
  }

  function closeHelp() {
    const back = helpReturn.current;
    if (back === "keys" && saved) {
      setPhase("keys");
      setMessages([{ id: nid(), from: "bot", widget: "keys" }]);
      return;
    }
    if (back === "service") {
      setPhase("service");
      setMessages([
        { id: nid(), from: "user", text: "OpenAI key added" },
        { id: nid(), from: "bot", widget: "service" },
      ]);
      return;
    }
    enterConnect();
  }

  function startChangeKeys() {
    setServiceRole("");
    setFormError("");
    if (saved) {
      setUrl(saved.supabaseUrl);
      setAnon("");
      setOpenai("");
      setPhase("keys");
      setMessages([{ id: nid(), from: "bot", widget: "keys" }]);
      return;
    }
    setCurrency("EUR");
    setBanks([]);
    setMany(false);
    enterConnect();
  }

  function setUpAgain() {
    setAnon("");
    setOpenai("");
    setServiceRole("");
    setCurrency("EUR");
    setBanks([]);
    setBankName("");
    setBankInitials("");
    setMany(false);
    enterConnect();
  }

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormError("");
    setPending(true);
    try {
      const result = await postJson("/api/setup/validate", {
        supabaseUrl: url.trim(),
        anonKey: anon.trim(),
      });
      if (!result.ok) {
        setFormError(result.error ?? "Could not connect.");
        return;
      }
      setPhase("openai");
      setMessages([
        { id: nid(), from: "user", text: `Connected to ${projectHost(url.trim())}` },
        { id: nid(), from: "bot", widget: "openai" },
      ]);
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
      const result = await postJson("/api/setup/openai", { apiKey: openai.trim() });
      if (!result.ok) {
        setFormError(result.error ?? "Could not check that key.");
        return;
      }
      setPhase("service");
      setMessages([
        { id: nid(), from: "user", text: "OpenAI key added" },
        { id: nid(), from: "bot", widget: "service" },
      ]);
    } finally {
      setPending(false);
    }
  }

  async function onCreateTables(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormError("");
    setPending(true);
    const key = serviceRole.trim();
    try {
      const result = await postJson("/api/setup/create-tables", {
        supabaseUrl: url.trim(),
        serviceRoleKey: key,
      });
      if (!result.ok) {
        if (result.code === "ddl_unavailable" || result.code === "incomplete") {
          setServiceRole("");
          setCopied(false);
          setPhase("sql");
          setMessages([
            { id: nid(), from: "bot", widget: "sql", text: result.error },
          ]);
          return;
        }
        setFormError(result.error ?? "Could not create tables.");
        return;
      }
      setServiceRole("");
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
    try {
      const result = await saveHousehold({
        supabaseUrl: url.trim(),
        anonKey: anon.trim(),
        currency,
        banks: savedBanks,
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      const connection: SavedConnection = {
        v: 1,
        supabaseUrl: url.trim(),
        anonKey: anon.trim(),
        openaiApiKey: openai.trim(),
        currency,
        banks: savedBanks,
      };
      if (!persist(connection)) return;
      setSaved(connection);
      setAnon("");
      setOpenai("");
      setServiceRole("");
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

  async function onCheckTables() {
    if (pending) return;
    setFormError("");
    setPending(true);
    try {
      const ready = await schemaReady(
        url.trim() || saved?.supabaseUrl || "",
        anon.trim() || saved?.anonKey || "",
      );
      if (!ready) {
        setFormError("Those tables aren’t visible yet. Run the SQL, then check again.");
        return;
      }
      showCurrencyStep();
    } finally {
      setPending(false);
    }
  }

  async function onCopySql() {
    if (!sqlText) return;
    try {
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
    } catch {
      setCopied(false);
      setFormError("Select the SQL and copy it.");
    }
  }

  async function onSaveKeys(event: FormEvent) {
    event.preventDefault();
    if (!saved || pending) return;
    setFormError("");
    const nextUrl = url.trim() || saved.supabaseUrl;
    const nextAnon = anon.trim() || saved.anonKey;
    const nextOpenAi = openai.trim() || saved.openaiApiKey;
    setPending(true);
    const key = serviceRole.trim();
    try {
      const [supabaseResult, openAiResult] = await Promise.all([
        postJson("/api/setup/validate", { supabaseUrl: nextUrl, anonKey: nextAnon }),
        postJson("/api/setup/openai", { apiKey: nextOpenAi }),
      ]);
      if (!supabaseResult.ok) {
        setFormError(supabaseResult.error ?? "Could not check Supabase.");
        return;
      }
      if (!openAiResult.ok) {
        setFormError(openAiResult.error ?? "Could not check the OpenAI key.");
        return;
      }
      if (key) {
        const created = await postJson("/api/setup/create-tables", {
          supabaseUrl: nextUrl,
          serviceRoleKey: key,
        });
        setServiceRole("");
        const connection: SavedConnection = {
          ...saved,
          supabaseUrl: nextUrl,
          anonKey: nextAnon,
          openaiApiKey: nextOpenAi,
        };
        if (!created.ok) {
          if (created.code === "ddl_unavailable" || created.code === "incomplete") {
            if (!persist(connection)) return;
            setSaved(connection);
            setUrl(nextUrl);
            setAnon("");
            setOpenai("");
            setCopied(false);
            setPhase("sql");
            setMessages([{ id: nid(), from: "bot", widget: "sql", text: created.error }]);
            return;
          }
          setFormError(created.error ?? "Could not recreate tables.");
          return;
        }
        if (!persist(connection)) return;
        showSaved(connection);
        return;
      }
      const connection: SavedConnection = {
        ...saved,
        supabaseUrl: nextUrl,
        anonKey: nextAnon,
        openaiApiKey: nextOpenAi,
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
  const showChange =
    phase !== "boot" && phase !== "help" && phase !== "connect" && phase !== "keys";
  const showComposer = phase !== "boot" && phase !== "help";

  function renderRich(rich: Rich) {
    if (rich === "welcome") {
      return (
        <>
          Welcome — let’s connect your own Supabase project. You’ll need the{" "}
          <strong>Project URL</strong> and <strong>anon key</strong> from Project
          Settings → API.
        </>
      );
    }
    if (rich === "next") {
      return (
        <>
          Next steps after connect: create tables → pick currency (default €) → banks
          → you’re ready.
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
    if (message.widget === "connect") {
      return (
        <form onSubmit={onConnect} data-testid="connect-form">
          <p>
            Paste them below. For the one-time table create, we’ll also ask for the{" "}
            <strong>service role key</strong> — we discard it after setup.
          </p>
          <div className="setup-field">
            <label htmlFor="project-url">Project URL</label>
            <input
              id="project-url"
              name="hb-project-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://xxxx.supabase.co"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="setup-field">
            <label htmlFor="anon-key">Anon key</label>
            <input
              id="anon-key"
              name="hb-anon-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="eyJhbGciOi…"
              value={locked ? "" : anon}
              disabled={busy}
              onChange={(event) => setAnon(event.target.value)}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={busy}>
              {pending && !locked ? "Checking…" : "Connect"}
            </button>
            <button
              className="setup-chip"
              type="button"
              disabled={busy}
              onClick={openHelp}
            >
              Where do I find these?
            </button>
            {saved ? (
              <button
                className="setup-chip"
                type="button"
                disabled={busy}
                onClick={() => showSaved(saved)}
              >
                Back
              </button>
            ) : null}
          </div>
        </form>
      );
    }
    if (message.widget === "openai") {
      return (
        <form onSubmit={onOpenAi}>
          <p>
            Paste your <strong>OpenAI API key</strong>. We ask once and keep it in
            this browser.
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
    if (message.widget === "service") {
      return (
        <form onSubmit={onCreateTables}>
          <p>
            Paste the <strong>service role key</strong> to create tables. We use it
            for this request and then discard it.
          </p>
          <div className="setup-field">
            <label htmlFor="service-role">Service role key</label>
            <input
              id="service-role"
              name="hb-service-role"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="eyJhbGciOi…"
              value={locked ? "" : serviceRole}
              disabled={busy}
              onChange={(event) => setServiceRole(event.target.value)}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={busy}>
              {pending && !locked ? "Creating…" : "Create tables"}
            </button>
            <button className="setup-chip" type="button" disabled={busy} onClick={openHelp}>
              Where do I find these?
            </button>
          </div>
        </form>
      );
    }
    if (message.widget === "sql") {
      return (
        <div>
          <p>{message.text}</p>
          <textarea
            className="setup-sql"
            readOnly
            spellCheck={false}
            value={sqlText}
            aria-label="Setup SQL"
          />
          <div className="setup-chips">
            <button
              className="setup-chip primary"
              type="button"
              disabled={busy || !sqlText}
              onClick={() => void onCopySql()}
            >
              {copied ? "Copied" : "Copy SQL"}
            </button>
            <button
              className="setup-chip"
              type="button"
              disabled={busy}
              onClick={() => void onCheckTables()}
            >
              {pending && !locked ? "Checking…" : "Check tables"}
            </button>
          </div>
        </div>
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
              className={!many || !locked ? "setup-chip primary" : "setup-chip"}
              disabled={busy}
              onClick={() => chooseBankCount(false)}
            >
              One bank
            </button>
            <button
              type="button"
              className={many && locked ? "setup-chip primary" : "setup-chip"}
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
        <div>
          <p>Here’s what we’ll keep in this browser.</p>
          <ul className="setup-summary">
            <li>Supabase · {projectHost(url.trim())}</li>
            <li>Currency · {currencyChoiceLabel(currency)}</li>
            <li>Banks · {bankList(banks)}</li>
            <li>OpenAI key · this browser only</li>
            <li>Service role key discarded</li>
          </ul>
          <p>You can change keys later if they expire.</p>
          <div className="setup-chips">
            <button
              type="button"
              className="setup-chip primary"
              disabled={busy}
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
        <form onSubmit={(event) => void onSaveKeys(event)}>
          <p>
            Update a key that expired. Leave a field blank to keep the saved one. A
            service role key is only for recreating tables, then it’s discarded.
          </p>
          <div className="setup-field">
            <label htmlFor="change-url">Project URL</label>
            <input
              id="change-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              disabled={pending}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="setup-field">
            <label htmlFor="change-anon">Anon key</label>
            <input
              id="change-anon"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Leave blank to keep the saved anon key"
              value={anon}
              disabled={pending}
              onChange={(event) => setAnon(event.target.value)}
            />
          </div>
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
          <div className="setup-field">
            <label htmlFor="change-service">Service role key</label>
            <input
              id="change-service"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Optional — recreate tables, then discard"
              value={serviceRole}
              disabled={pending}
              onChange={(event) => setServiceRole(event.target.value)}
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
              onClick={openHelp}
            >
              Where do I find these?
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
          <p>Keys for this browser are already saved.</p>
          <ul className="setup-summary">
            <li>Supabase · {projectHost(saved.supabaseUrl)}</li>
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
            <button type="button" className="setup-chip" onClick={setUpAgain}>
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
          {showChange ? (
            <button type="button" className="setup-text-btn" onClick={startChangeKeys}>
              Change keys
            </button>
          ) : null}
          <div className="setup-step" data-testid="setup-step">
            {stepLabel(phase)}
          </div>
        </div>
      </header>
      <main className="setup-shell">
        {phase === "help" ? (
          <div className="setup-thread">
            <article className="setup-msg setup-bot setup-help">
              <h2>Where do I find these?</h2>
              <ol>
                <li>
                  Open <strong>supabase.com</strong> and sign in (free account is fine).
                </li>
                <li>
                  Create a project if you don’t have one yet — wait until it’s fully
                  ready.
                </li>
                <li>
                  In the left sidebar open <strong>Project Settings</strong> (gear), then{" "}
                  <strong>API</strong>.
                </li>
                <li>
                  <strong>Project URL</strong> — copy the URL under Project URL (looks
                  like <code>https://….supabase.co</code>).
                </li>
                <li>
                  <strong>anon key</strong> — under Project API keys, copy the{" "}
                  <strong>anon</strong> / <strong>public</strong> key (safe for the
                  browser).
                </li>
                <li>
                  <strong>service role key</strong> — same page, <strong>service_role</strong>{" "}
                  / secret. We’ll ask for this only once to create tables, then discard
                  it. Never share it in chat or screenshots.
                </li>
              </ol>
              <div className="setup-warn">
                Tip: if you don’t see API keys yet, the project may still be provisioning
                — refresh in a minute.
              </div>
              <div className="setup-chips">
                <button type="button" className="setup-chip primary" onClick={closeHelp}>
                  {helpReturn.current === "connect" || helpReturn.current === "boot"
                    ? "Back to connect"
                    : "Back"}
                </button>
                <a
                  className="setup-chip"
                  href="https://supabase.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open supabase.com
                </a>
              </div>
            </article>
          </div>
        ) : (
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
                    message.faded
                      ? "setup-msg setup-bot setup-faded"
                      : "setup-msg setup-bot"
                  }
                >
                  {message.rich ? renderRich(message.rich) : null}
                  {message.widget ? renderWidget(message) : null}
                  {!message.rich && !message.widget ? message.text : null}
                </div>
              ),
            )}
          </div>
        )}
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
