"use client";

import Link from "next/link";
import { TRACKER_HOME } from "@/components/tracker/nav";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  EndpointConnectionCard,
  LocalConnectionCard,
  AssistantChoice,
  postProbe,
} from "@/components/assistant/assistant-ui";
import {
  assistantSummary,
  assistantUsesKey,
  readConnection,
  rememberActiveBanks,
  writeConnection,
  type AssistantKind,
  type AssistantSettings,
  type SavedBank,
  type SavedConnection,
} from "@/lib/connection";
import { parseHousehold } from "@/lib/data/parse";
import { currencyConfirmLabel, describeCurrency, UNKNOWN_CURRENCY_ERROR } from "@/lib/currency";
import {
  CURRENCY_CHOICES,
  currencyChoiceLabel,
  currencySummaryLabel,
  normalizeBank,
  parseCurrencyText,
  suggestInitials,
} from "@/lib/setup/chat-logic";

type Phase =
  | "boot"
  | "saved"
  | "choose"
  | "openai"
  | "local"
  | "endpoint"
  | "currency"
  | "bank"
  | "bank-next"
  | "confirm"
  | "done"
  | "keys";

type Widget =
  | "choose"
  | "openai"
  | "local"
  | "endpoint"
  | "currency"
  | "bank"
  | "bank-next"
  | "confirm"
  | "done"
  | "keys"
  | "endpoint-keys"
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

const ADD_BANK = "Add your bank — name and initials.";
const ADD_ANOTHER_BANK = "Add another bank — name and initials.";
const THATS_ALL = "That’s all";
const INITIALS_HINT = "Initials are guessed from the name. You can edit them.";

function stepLabel(phase: Phase): string {
  if (phase === "saved") return "Setup · saved";
  if (phase === "keys") return "Setup · keys";
  if (phase === "boot") return "Setup";
  if (phase === "choose" || phase === "openai" || phase === "local" || phase === "endpoint") {
    return "Setup · step 1 of 4";
  }
  if (phase === "currency") return "Setup · step 2 of 4";
  if (phase === "bank" || phase === "bank-next") return "Setup · step 3 of 4";
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

function choiceThread(nid: () => number): Msg[] {
  return [
    { id: nid(), from: "bot", rich: "welcome" },
    { id: nid(), from: "bot", widget: "choose" },
  ];
}

function keyFact(assistant: AssistantSettings, where: "confirm" | "saved"): string {
  if (assistant.type === "local") return "OpenAI key · not needed";
  if (assistant.type === "endpoint") {
    return where === "confirm" ? "API key · this browser only" : "API key · saved in this browser";
  }
  return where === "confirm" ? "OpenAI key · this browser only" : "OpenAI key · saved in this browser";
}

function collapseBankForms(messages: Msg[]): Msg[] {
  return messages.map((message) =>
    message.widget === "bank"
      ? { id: message.id, from: message.from, text: message.text }
      : message,
  );
}

export function SetupChat({ startAtKeys = false }: { startAtKeys?: boolean }) {
  const idRef = useRef(100);
  const threadRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [openai, setOpenai] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [banks, setBanks] = useState<SavedBank[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankInitials, setBankInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [customCurrency, setCustomCurrency] = useState("");
  const [otherPreview, setOtherPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [kind, setKind] = useState<AssistantKind | null>(null);
  const [draft, setDraft] = useState<AssistantSettings | null>(null);
  const [endpointKey, setEndpointKey] = useState("");

  function nid() {
    idRef.current += 1;
    return idRef.current;
  }

  async function ensureInit(): Promise<boolean> {
    const result = await postJson("/api/setup/init", {});
    if (!result.ok) {
      setFormError(result.error ?? "Could not prepare the local database.");
      return false;
    }
    return true;
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

  function resetBankDraft() {
    setBankName("");
    setBankInitials("");
    setInitialsTouched(false);
  }

  function showChoice() {
    setFormError("");
    setKind(null);
    setDraft(null);
    setPhase("choose");
    setMessages(choiceThread(nid));
  }

  function showOpenAiStep() {
    setFormError("");
    setPhase("openai");
    setMessages([{ id: nid(), from: "bot", widget: "openai" }]);
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
    setCustomCurrency("");
    setOtherPreview(null);
    setCurrency("EUR");
    setPhase("currency");
    setMessages([
      { id: nid(), from: "bot", rich: "tables" },
      { id: nid(), from: "bot", widget: "currency" },
    ]);
  }

  useEffect(() => {
    let ignore = false;
    const existing = readConnection();
    if (existing && startAtKeys && existing.assistant.type !== "local") {
      setSaved(existing);
      setCurrency(existing.currency);
      setBanks(existing.banks);
      setDraft(existing.assistant);
      setOpenai("");
      setEndpointKey("");
      setPhase("keys");
      setMessages([
        {
          id: 1,
          from: "bot",
          widget: existing.assistant.type === "endpoint" ? "endpoint-keys" : "keys",
        },
      ]);
    } else if (existing) {
      setSaved(existing);
      setCurrency(existing.currency);
      setBanks(existing.banks);
      setDraft(existing.assistant);
      setPhase("saved");
      setMessages([{ id: 1, from: "bot", widget: "saved" }]);
    } else {
      setPhase("choose");
      setMessages([
        { id: 1, from: "bot", rich: "welcome" },
        { id: 2, from: "bot", widget: "choose" },
      ]);
    }
    void (async () => {
      const result = await postJson("/api/setup/init", {});
      if (!ignore && !result.ok) {
        setFormError(result.error ?? "Could not prepare the local database.");
      }
      if (!existing || ignore) return;
      try {
        const response = await fetch("/api/household");
        const household = parseHousehold(await response.json());
        if (ignore || !household) return;
        const changed = rememberActiveBanks(household);
        const current = changed ? readConnection() : existing;
        if (!current) return;
        setSaved(current);
        setCurrency(current.currency);
        setBanks(current.banks);
      } catch {
        // Keep the banks already stored in this browser.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [startAtKeys]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    // A step taller than the view (the assistant forms) opens at its top, not at its last line.
    const steps = thread.querySelectorAll<HTMLElement>(".setup-msg");
    const last = steps[steps.length - 1];
    if (last && last.offsetHeight > thread.clientHeight) {
      const top = last.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
      thread.scrollTop = Math.max(0, top - 8);
      return;
    }
    thread.scrollTop = thread.scrollHeight;
  }, [messages, phase, formError]);

  function startChangeKeys() {
    setFormError("");
    setOpenai("");
    setEndpointKey("");
    const assistant = saved?.assistant ?? draft;
    if (!assistant || assistant.type === "local") return;
    if (!saved) {
      if (assistant.type === "openai") showOpenAiStep();
      else {
        setPhase("endpoint");
        setMessages([{ id: nid(), from: "bot", widget: "endpoint" }]);
      }
      return;
    }
    setPhase("keys");
    setMessages([
      {
        id: nid(),
        from: "bot",
        widget: assistant.type === "endpoint" ? "endpoint-keys" : "keys",
      },
    ]);
  }

  function chooseAssistant() {
    if (kind === "openai") showOpenAiStep();
    else if (kind === "local") {
      setPhase("local");
      setMessages([{ id: nid(), from: "bot", widget: "local" }]);
    } else if (kind === "endpoint") {
      setPhase("endpoint");
      setMessages([{ id: nid(), from: "bot", widget: "endpoint" }]);
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
      setDraft({ type: "openai", apiKey: openai.trim() });
      showCurrencyStep();
    } finally {
      setPending(false);
    }
  }

  function chooseCurrency(code: string) {
    if (pending || phase !== "currency") return;
    setCurrency(code);
    setShowOther(false);
    setCustomCurrency("");
    setOtherPreview(null);
    setFormError("");
    resetBankDraft();
    setPhase("bank");
    const userId = nid();
    const botId = nid();
    setMessages((prev) => [
      ...prev,
      { id: userId, from: "user", text: currencyChoiceLabel(code) },
      { id: botId, from: "bot", widget: "bank", text: ADD_BANK },
    ]);
  }

  function onOther(event: FormEvent) {
    event.preventDefault();
    const code = parseCurrencyText(customCurrency);
    const known = code ? describeCurrency(code) : null;
    if (!known) {
      setOtherPreview(null);
      setFormError(UNKNOWN_CURRENCY_ERROR);
      return;
    }
    const label = currencyConfirmLabel(known);
    if (otherPreview !== label) {
      setFormError("");
      setOtherPreview(label);
      return;
    }
    chooseCurrency(known.code);
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
    resetBankDraft();
    setPhase("bank-next");
    const userId = nid();
    const botId = nid();
    const savedLabel = `${bank.name} (${bank.initials})`;
    setMessages((prev) => [
      ...collapseBankForms(prev),
      { id: userId, from: "user", text: savedLabel },
      {
        id: botId,
        from: "bot",
        widget: "bank-next",
        text: `Saved ${savedLabel}. Add another bank?`,
      },
    ]);
  }

  function addAnother() {
    setFormError("");
    resetBankDraft();
    setPhase("bank");
    const id = nid();
    setMessages((prev) => [
      ...prev.filter((message) => message.widget !== "bank-next"),
      { id, from: "bot", widget: "bank", text: ADD_ANOTHER_BANK },
    ]);
  }

  function finishBanks() {
    if (banks.length === 0) {
      setFormError("Add at least one bank.");
      return;
    }
    setFormError("");
    setPhase("confirm");
    setMessages([
      { id: nid(), from: "user", text: THATS_ALL },
      { id: nid(), from: "bot", widget: "confirm" },
    ]);
  }

  async function onConfirm() {
    if (pending || phase !== "confirm") return;
    if (banks.length === 0) {
      setFormError("Add at least one bank.");
      return;
    }
    setFormError("");
    setPending(true);
    const savedBanks = banks;
    const assistant = draft;
    if (!assistant) {
      setFormError("Choose how the assistant should work.");
      setPending(false);
      return;
    }
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
        v: 3,
        assistant,
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
    if (saved.assistant.type !== "openai") return;
    const nextOpenAi = openai.trim() || saved.assistant.apiKey;
    setPending(true);
    try {
      const result = await postJson("/api/setup/openai", { apiKey: nextOpenAi });
      if (!result.ok) {
        setFormError(result.error ?? "Could not check the OpenAI key.");
        return;
      }
      const connection: SavedConnection = {
        v: 3,
        assistant: { type: "openai", apiKey: nextOpenAi },
        currency: saved.currency,
        banks: saved.banks,
      };
      if (!persist(connection)) return;
      showSaved(connection);
    } finally {
      setPending(false);
    }
  }

  async function onSaveEndpointKeys(event: FormEvent) {
    event.preventDefault();
    if (!saved || saved.assistant.type !== "endpoint" || pending) return;
    const apiKey = endpointKey.trim() || saved.assistant.apiKey;
    setFormError("");
    setPending(true);
    try {
      const result = await postProbe({
        type: "endpoint",
        baseUrl: saved.assistant.baseUrl,
        model: saved.assistant.model,
        apiKey,
      });
      if (!result.ok) {
        setFormError(result.title ?? result.error ?? "Could not check that key.");
        return;
      }
      const connection: SavedConnection = {
        ...saved,
        v: 3,
        assistant: { ...saved.assistant, apiKey },
      };
      if (!persist(connection)) return;
      showSaved(connection);
    } finally {
      setPending(false);
    }
  }

  const activeWidgetId = [...messages].reverse().find((message) => message.widget)?.id;

  function renderRich(rich: Rich) {
    if (rich === "welcome") {
      return (
        <>
          Welcome — your money stays in a database on this computer. First, choose how the assistant
          should work.
        </>
      );
    }
    if (rich === "next") {
      return <>Next: pick currency → banks → confirm.</>;
    }
    if (rich === "tables") {
      return (
        <>
          Tables are ready with default categories: food, rent, household, grocery,
          bill, miscellaneous, salary.
        </>
      );
    }
    return <>What currency should we use?</>;
  }

  function renderWidget(message: Msg) {
    const locked = message.id !== activeWidgetId;
    const busy = pending || locked;
    if (message.widget === "choose") {
      return (
        <AssistantChoice
          value={kind}
          onChange={(next) => {
            setKind(next);
            setFormError("");
          }}
          onContinue={chooseAssistant}
          disabled={busy}
        />
      );
    }
    if (message.widget === "local") {
      return (
        <div>
          <LocalConnectionCard
            continueLabel="Continue"
            onContinue={(address, model, ocrModel) => {
              setDraft({
                type: "local",
                address,
                model,
                ...(ocrModel ? { ocrModel } : {}),
              });
              showCurrencyStep();
            }}
          />
          <div className="setup-chips">
            <button type="button" className="setup-chip" disabled={pending} onClick={showChoice}>
              Choose again
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "endpoint") {
      return (
        <div>
          <EndpointConnectionCard
            continueLabel="Continue"
            onContinue={(baseUrl, model, apiKey) => {
              setDraft({ type: "endpoint", baseUrl, model, apiKey });
              showCurrencyStep();
            }}
          />
          <div className="setup-chips">
            <button type="button" className="setup-chip" disabled={pending} onClick={showChoice}>
              Choose again
            </button>
          </div>
        </div>
      );
    }
    if (message.widget === "openai") {
      return (
        <form onSubmit={(event) => void onOpenAi(event)} data-testid="openai-form">
          <p>
            Paste your <strong>OpenAI API key</strong>.
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
            <button type="button" className="setup-chip" disabled={pending} onClick={showChoice}>
              Choose again
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
            {CURRENCY_CHOICES.map((choice) => (
              <button
                key={choice.code}
                type="button"
                className={currency === choice.code ? "setup-chip primary" : "setup-chip"}
                aria-pressed={currency === choice.code}
                disabled={busy}
                onClick={() => chooseCurrency(choice.code)}
              >
                {choice.label}
              </button>
            ))}
            <button
              type="button"
              className="setup-chip"
              aria-expanded={showOther}
              disabled={busy}
              onClick={() => {
                setShowOther(true);
                setFormError("");
              }}
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
                  maxLength={3}
                  disabled={pending}
                  onChange={(event) => {
                    setCustomCurrency(event.target.value);
                    setOtherPreview(null);
                  }}
                />
              </div>
              {otherPreview ? (
                <p className="setup-currency-confirm" data-testid="currency-confirm">
                  {otherPreview}
                </p>
              ) : null}
              <div className="setup-chips">
                <button
                  className={otherPreview ? "setup-chip primary" : "setup-chip"}
                  type="submit"
                  disabled={pending}
                >
                  {otherPreview ? "Use this currency" : "Check code"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      );
    }
    if (message.widget === "bank") {
      const showHint = !locked && bankName.trim().length > 0;
      return (
        <form onSubmit={onSaveBank} data-testid="bank-form">
          <p>{message.text ?? ADD_BANK}</p>
          <div className="setup-field">
            <label htmlFor={`bank-name-${message.id}`}>Bank name</label>
            <input
              id={`bank-name-${message.id}`}
              value={locked ? "" : bankName}
              disabled={busy}
              autoComplete="off"
              placeholder="Sparkasse"
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
              placeholder="SPK"
              aria-describedby={showHint ? `bank-hint-${message.id}` : undefined}
              onChange={(event) => {
                setInitialsTouched(true);
                setBankInitials(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
                );
              }}
            />
          </div>
          {showHint ? (
            <p className="setup-hint" id={`bank-hint-${message.id}`}>
              {INITIALS_HINT}
            </p>
          ) : null}
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
        <div data-testid="bank-next">
          <p>{message.text}</p>
          <div className="setup-chips">
            <button
              type="button"
              className="setup-chip primary"
              disabled={busy}
              onClick={addAnother}
            >
              Add another bank
            </button>
            <button type="button" className="setup-chip" disabled={busy} onClick={finishBanks}>
              {THATS_ALL}
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
            <li>Assistant · {draft ? assistantSummary(draft) : "not chosen"}</li>
            <li>Currency · {currencySummaryLabel(currency)}</li>
            <li>Banks · {bankList(banks)}</li>
            <li>{draft ? keyFact(draft, "confirm") : "OpenAI key · this browser only"}</li>
          </ul>
          <p>You can change this later under Review the data.</p>
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
            {draft && assistantUsesKey(draft) ? (
              <button type="button" className="setup-chip" disabled={busy} onClick={startChangeKeys}>
                Change keys
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (message.widget === "done") {
      return (
        <div>
          <p>You’re set. The welcome screen will show Open tracker.</p>
          <div className="setup-chips">
            <Link className="setup-chip primary" href={TRACKER_HOME}>
              Open tracker
            </Link>
            <Link className="setup-chip" href="/">
              Back to welcome
            </Link>
            {saved && assistantUsesKey(saved.assistant) ? (
              <button type="button" className="setup-chip" onClick={startChangeKeys}>
                Change keys
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (message.widget === "endpoint-keys" && saved?.assistant.type === "endpoint") {
      return (
        <form onSubmit={(event) => void onSaveEndpointKeys(event)}>
          <p>Update the key for this endpoint. Leave the field blank to keep the saved key.</p>
          <div className="setup-field">
            <label htmlFor="change-endpoint-key">API key</label>
            <input
              id="change-endpoint-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Leave blank to keep the saved key"
              value={endpointKey}
              disabled={pending}
              onChange={(event) => setEndpointKey(event.target.value)}
            />
          </div>
          <div className="setup-chips">
            <button className="setup-chip primary" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save keys"}
            </button>
            <button className="setup-chip" type="button" disabled={pending} onClick={() => showSaved(saved)}>
              Cancel
            </button>
          </div>
        </form>
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
            <li>Currency · {currencySummaryLabel(saved.currency)}</li>
            <li>Banks · {bankList(saved.banks)}</li>
            <li>Assistant · {assistantSummary(saved.assistant)}</li>
            <li>{keyFact(saved.assistant, "saved")}</li>
          </ul>
          <div className="setup-chips">
            <Link className="setup-chip primary" href={TRACKER_HOME}>
              Open tracker
            </Link>
            {assistantUsesKey(saved.assistant) ? (
              <button type="button" className="setup-chip" onClick={startChangeKeys}>
                Change keys
              </button>
            ) : null}
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
          {saved && assistantUsesKey(saved.assistant) ? (
            <button type="button" className="setup-text-btn" onClick={startChangeKeys} disabled={pending}>
              Change keys
            </button>
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
          {formError ? (
            <p className="setup-error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
