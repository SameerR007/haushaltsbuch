"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  DEFAULT_LOCAL_ADDRESS,
  DEFAULT_LOCAL_MODEL,
  ENDPOINT_IMPORT_NOTE,
  ENDPOINT_IMPORT_TITLE,
  LM_STUDIO_ADDRESS,
  LOCAL_MODEL_HINT,
  LOCAL_NUM_CTX,
  OCR_MODEL_HINT,
  OCR_NONE_NOTE,
  OCR_PLACEHOLDER,
  OCR_SECTION_BODY,
  OCR_SECTION_TITLE,
  SUGGESTED_OCR_MODEL,
} from "@/lib/assistant/copy";
import type { AssistantKind } from "@/lib/assistant/target";

export type ProbeView = {
  ok: boolean;
  status?: string;
  title?: string;
  detail?: string;
  command?: string;
  error?: string;
};

const CHOICES: { id: AssistantKind; title: string; body: string }[] = [
  {
    id: "openai",
    title: "On OpenAI",
    body: "Fastest and most accurate. Your questions and statements are sent to OpenAI, which is told not to keep them. Needs an API key.",
  },
  {
    id: "local",
    title: "On this computer",
    body: "Private. Nothing leaves this machine. Needs the free Ollama or LM Studio app and a download of about 6–7 GB. Slower, and reading statements is less polished.",
  },
  {
    id: "endpoint",
    title: "OpenAI-compatible endpoint",
    body: "Use your own address, key and model.",
  },
];

export function AssistantChoice({
  value,
  current,
  onChange,
  onContinue,
  continueLabel = "Continue",
  disabled = false,
}: {
  value: AssistantKind | null;
  current?: AssistantKind | null;
  onChange: (kind: AssistantKind) => void;
  onContinue?: () => void;
  continueLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div data-testid="assistant-choice">
      <p>
        <strong>Where should the assistant think?</strong>
      </p>
      <div className="assistant-options" role="radiogroup" aria-label="Where should the assistant think?">
        {CHOICES.map((choice) => {
          const selected = value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "assistant-option is-selected" : "assistant-option"}
              disabled={disabled}
              onClick={() => onChange(choice.id)}
            >
              <span className="assistant-option-mark" aria-hidden="true" />
              <span>
                <span className="assistant-option-title">
                  {choice.title}
                  {current === choice.id ? <span className="assistant-current">current</span> : null}
                </span>
                <span className="assistant-option-body">{choice.body}</span>
              </span>
            </button>
          );
        })}
      </div>
      {onContinue ? (
        <>
          <p className="setup-hint">You can change this later under Review the data.</p>
          <div className="setup-chips">
            <button
              className="setup-chip primary"
              type="button"
              disabled={disabled || !value}
              onClick={onContinue}
            >
              {continueLabel}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function LocalConnectionCard({
  initialAddress = DEFAULT_LOCAL_ADDRESS,
  initialModel = DEFAULT_LOCAL_MODEL,
  initialOcr,
  continueLabel,
  onContinue,
  onReadyChange,
  cancelHref,
  intro = true,
  showHelp = true,
}: {
  initialAddress?: string;
  initialModel?: string;
  /** Omit to prefill the suggested OCR model. Pass null when none is saved. */
  initialOcr?: string | null;
  continueLabel?: string;
  onContinue?: (address: string, model: string, ocrModel: string | null) => void;
  onReadyChange?: (ready: { address: string; model: string; ocrModel: string | null } | null) => void;
  cancelHref?: string;
  intro?: boolean;
  showHelp?: boolean;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [model, setModel] = useState(initialModel);
  const [ocrModel, setOcrModel] = useState(initialOcr === undefined ? SUGGESTED_OCR_MODEL : (initialOcr ?? ""));
  const [ocrNone, setOcrNone] = useState(initialOcr === null || initialOcr === "");
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [ocrProbe, setOcrProbe] = useState<ProbeView | null>(null);
  const [pending, setPending] = useState(false);
  const [ocrPending, setOcrPending] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ocrCopied, setOcrCopied] = useState(false);
  const ready = probe?.ok === true;
  const chosenOcr = ocrNone ? null : ocrModel.trim() || null;

  function publish(nextProbe: ProbeView | null, ocr: string | null) {
    if (nextProbe?.ok !== true) {
      onReadyChange?.(null);
      return;
    }
    onReadyChange?.({ address: address.trim(), model: model.trim(), ocrModel: ocr });
  }

  function edit(nextAddress: string, nextModel: string) {
    setAddress(nextAddress);
    setModel(nextModel);
    setProbe(null);
    setHelpOpen(false);
    onReadyChange?.(null);
  }

  async function onTest(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setCopied(false);
    setProbe(null);
    onReadyChange?.(null);
    const result = await postProbe({ type: "local", address: address.trim(), model: model.trim() });
    setProbe(result);
    setHelpOpen(false);
    publish(result, chosenOcr);
    setPending(false);
  }

  async function onTestOcr() {
    if (ocrPending || ocrNone || !ocrModel.trim()) return;
    setOcrPending(true);
    setOcrCopied(false);
    setOcrProbe(null);
    const result = await postProbe({ type: "ocr", address: address.trim(), model: ocrModel.trim() });
    setOcrProbe(result);
    setOcrPending(false);
  }

  function chooseNone() {
    setOcrNone(true);
    setOcrModel("");
    setOcrProbe(null);
    publish(probe, null);
  }

  function editOcr(value: string) {
    setOcrModel(value);
    setOcrNone(false);
    setOcrProbe(null);
    publish(probe, value.trim() || null);
  }

  return (
    <form onSubmit={(event) => void onTest(event)} data-testid="local-assistant-form">
      {intro ? (
        <p>
          <strong>On this computer.</strong> The assistant runs on a free model here, so nothing leaves this
          machine.
        </p>
      ) : null}
      <div className="setup-field">
        <label htmlFor="local-address">App address</label>
        <input
          id="local-address"
          value={address}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          onChange={(event) => edit(event.target.value, model)}
        />
      </div>
      <p className="setup-hint">
        Ollama: {DEFAULT_LOCAL_ADDRESS} · LM Studio: {LM_STUDIO_ADDRESS}
      </p>
      <div className="setup-field">
        <label htmlFor="local-model">Model</label>
        <input
          id="local-model"
          value={model}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          onChange={(event) => edit(address, event.target.value)}
        />
      </div>
      <p className="setup-hint">{LOCAL_MODEL_HINT}</p>
      <div className="setup-chips">
        <button className="setup-chip primary" type="submit" disabled={pending} data-testid="test-connection">
          {pending ? "Testing…" : "Test connection"}
        </button>
        {cancelHref ? (
          <Link className="setup-chip" href={cancelHref}>
            Cancel
          </Link>
        ) : null}
      </div>
      <ProbeBanner probe={probe} copied={copied} onCopy={setCopied} />
      <hr className="assistant-split" />
      <p>
        <strong>{OCR_SECTION_TITLE}</strong> <span className="setup-hint">(optional)</span>
      </p>
      <p className="setup-hint">{OCR_SECTION_BODY}</p>
      <div className="setup-field">
        <label htmlFor="ocr-model">OCR model</label>
        <input
          id="ocr-model"
          value={ocrNone ? "" : ocrModel}
          placeholder={OCR_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          disabled={pending || ocrPending}
          data-testid="ocr-model"
          onChange={(event) => editOcr(event.target.value)}
        />
      </div>
      <p className="setup-hint">{OCR_MODEL_HINT}</p>
      <div className="setup-chips">
        <button
          className="setup-chip primary"
          type="button"
          disabled={pending || ocrPending || ocrNone || !ocrModel.trim()}
          data-testid="ocr-test"
          onClick={() => void onTestOcr()}
        >
          {ocrPending ? "Testing…" : "Test connection"}
        </button>
        <button
          className={ocrNone ? "setup-chip is-selected" : "setup-chip"}
          type="button"
          aria-pressed={ocrNone}
          data-testid="ocr-none"
          disabled={pending || ocrPending}
          onClick={chooseNone}
        >
          {ocrNone ? "✓ None" : "None"}
        </button>
      </div>
      {ocrNone ? (
        <div className="assistant-banner is-warn" role="status" data-testid="ocr-none-note">
          <p>{OCR_NONE_NOTE}</p>
        </div>
      ) : (
        <ProbeBanner probe={ocrProbe} copied={ocrCopied} onCopy={setOcrCopied} />
      )}
      {continueLabel && onContinue && ready ? (
        <div className="setup-chips">
          <button
            className="setup-chip primary"
            type="button"
            disabled={pending || ocrPending}
            data-testid="assistant-continue"
            onClick={() => onContinue(address.trim(), model.trim(), chosenOcr)}
          >
            {continueLabel}
          </button>
        </div>
      ) : null}
      {showHelp ? (
        probe ? (
          <HelpToggle open={helpOpen} onToggle={() => setHelpOpen((open) => !open)} />
        ) : (
          <LocalHelp />
        )
      ) : null}
    </form>
  );
}

export function EndpointConnectionCard({
  initialUrl = "",
  initialModel = "",
  initialKey = "",
  continueLabel,
  onContinue,
  onReadyChange,
  cancelHref,
  intro = true,
}: {
  initialUrl?: string;
  initialModel?: string;
  initialKey?: string;
  continueLabel?: string;
  onContinue?: (baseUrl: string, model: string, apiKey: string) => void;
  onReadyChange?: (ready: { baseUrl: string; model: string; apiKey: string } | null) => void;
  cancelHref?: string;
  intro?: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(initialUrl);
  const [apiKey, setApiKey] = useState(initialKey);
  const [model, setModel] = useState(initialModel);
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [pending, setPending] = useState(false);
  const ready = probe?.ok === true;

  function edit(next: { baseUrl?: string; apiKey?: string; model?: string }) {
    const url = next.baseUrl ?? baseUrl;
    const key = next.apiKey ?? apiKey;
    const name = next.model ?? model;
    setBaseUrl(url);
    setApiKey(key);
    setModel(name);
    setProbe(null);
    onReadyChange?.(null);
  }

  async function onTest(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProbe(null);
    onReadyChange?.(null);
    const result = await postProbe({
      type: "endpoint",
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: apiKey.trim(),
    });
    setProbe(result);
    if (result.ok) {
      onReadyChange?.({ baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() });
    }
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void onTest(event)} data-testid="endpoint-assistant-form">
      {intro ? (
        <p>
          <strong>OpenAI-compatible endpoint.</strong> Use any service or app that speaks the OpenAI API.
        </p>
      ) : null}
      <div className="setup-field">
        <label htmlFor="endpoint-url">Base URL</label>
        <input
          id="endpoint-url"
          value={baseUrl}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://your-server.example/v1"
          disabled={pending}
          onChange={(event) => edit({ baseUrl: event.target.value })}
        />
      </div>
      <div className="setup-field">
        <label htmlFor="endpoint-key">API key</label>
        <input
          id="endpoint-key"
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder="Key for this endpoint"
          disabled={pending}
          onChange={(event) => edit({ apiKey: event.target.value })}
        />
      </div>
      <div className="setup-field">
        <label htmlFor="endpoint-model">Model name</label>
        <input
          id="endpoint-model"
          value={model}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. the model id your service lists"
          disabled={pending}
          onChange={(event) => edit({ model: event.target.value })}
        />
      </div>
      <div className="setup-chips">
        <button className="setup-chip primary" type="submit" disabled={pending} data-testid="test-connection">
          {pending ? "Testing…" : "Test connection"}
        </button>
        {cancelHref ? (
          <Link className="setup-chip" href={cancelHref}>
            Cancel
          </Link>
        ) : null}
      </div>
      <ProbeBanner probe={probe} />
      {ready ? (
        <div className="assistant-banner is-warn" data-testid="endpoint-import-note">
          <p>
            <strong>{ENDPOINT_IMPORT_TITLE}</strong>
          </p>
          <p>{ENDPOINT_IMPORT_NOTE}</p>
        </div>
      ) : null}
      {continueLabel && onContinue && ready ? (
        <div className="setup-chips">
          <button
            className="setup-chip primary"
            type="button"
            disabled={pending}
            data-testid="assistant-continue"
            onClick={() => onContinue(baseUrl.trim(), model.trim(), apiKey.trim())}
          >
            {continueLabel}
          </button>
        </div>
      ) : null}
      <p className="setup-hint">
        The key is kept in this browser only. Questions and statements go to the address you enter, so use a
        service you trust.
      </p>
    </form>
  );
}

export function ProbeBanner({
  probe,
  copied = false,
  onCopy,
}: {
  probe: ProbeView | null;
  copied?: boolean;
  onCopy?: (copied: boolean) => void;
}) {
  if (!probe) return null;
  const tone = probe.ok ? (probe.status === "slow" ? "slow" : "ok") : "bad";
  return (
    <div className={`assistant-banner is-${tone}`} role="status" data-testid="probe-result">
      <p>
        <strong>
          {tone === "ok" ? "✓ " : ""}
          {probe.title ?? probe.error ?? "Could not test that connection."}
        </strong>
      </p>
      {probe.detail ? <p>{probe.detail}</p> : null}
      {probe.command ? (
        <div className="assistant-command">
          <code>{probe.command}</code>
          <button
            type="button"
            className="assistant-copy"
            onClick={() => {
              const command = probe.command ?? "";
              void navigator.clipboard?.writeText(command).then(
                () => onCopy?.(true),
                () => onCopy?.(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HelpToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="assistant-help-wrap">
      <button type="button" className="assistant-help-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? "▼" : "▶"} Need help setting this up?
      </button>
      {open ? <LocalHelp /> : null}
    </div>
  );
}

export function LocalHelp() {
  return (
    <div className="assistant-help">
      <p>
        <strong>Set up the assistant on this computer</strong>
      </p>
      <ol>
        <li>
          Install <strong>Ollama</strong> from ollama.com and open it once. It then runs in the background. (LM
          Studio also works.)
        </li>
        <li>
          Open Terminal and run <code>ollama pull qwen3.5:9b</code>. This is a one-time download of about 6–7 GB.
          For scanned statements also run <code>ollama pull glm-ocr</code> (small).
        </li>
        <li>
          You need about <strong>16 GB of RAM</strong>. A recent Mac with Apple silicon, or a PC with an 8 GB+
          graphics card, is comfortable. On less it works, but slowly.
        </li>
        <li>
          Come back here and press <strong>Test connection</strong>.
        </li>
      </ol>
      <p>
        These commands are the same on Mac, Windows, and Linux. The app asks Ollama for a context length of{" "}
        {LOCAL_NUM_CTX} tokens. If answers are cut off, raise Ollama’s context length and open the app again.
      </p>
    </div>
  );
}

export async function postProbe(body: object): Promise<ProbeView> {
  try {
    const response = await fetch("/api/setup/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) {
      return { ok: false, title: "Could not test that connection.", detail: "Try again." };
    }
    const row = data as ProbeView & { error?: string };
    if (typeof row.title !== "string" && typeof row.error === "string") {
      return { ok: false, title: row.error, detail: "" };
    }
    return {
      ok: row.ok === true,
      status: typeof row.status === "string" ? row.status : undefined,
      title: typeof row.title === "string" ? row.title : row.error,
      detail: typeof row.detail === "string" ? row.detail : undefined,
      command: typeof row.command === "string" ? row.command : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
    };
  } catch {
    return { ok: false, title: "Could not reach the setup service.", detail: "Try again." };
  }
}
