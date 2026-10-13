import { looksLikeOpenAiKey } from "@/lib/setup/guards";
import { LOCAL_NUM_CTX } from "./copy";

export type AssistantKind = "openai" | "local" | "endpoint";

/** What one chat or PDF turn talks to. The turn loop does not branch on this. */
export type AssistantTarget =
  | { type: "openai"; apiKey: string }
  | { type: "local"; baseUrl: string; model: string; ocrModel?: string | null }
  | { type: "endpoint"; baseUrl: string; model: string; apiKey: string };

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Chat Completions base URL. A bare app address such as http://localhost:11434
 * becomes http://localhost:11434/v1. A URL that already ends in /v1 is kept.
 */
export function chatBaseUrl(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path === "" || path === "/" ? "/v1" : path;
  return url.toString().replace(/\/$/, "");
}

export function modelNameOk(model: string): boolean {
  return MODEL_PATTERN.test(model.trim());
}

/** Missing or blank is no OCR model. A non-empty invalid id is rejected. */
function optionalModel(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const model = value.trim();
  if (!model) return null;
  return modelNameOk(model) ? model : "invalid";
}

export function localAddressError(address: string): string | null {
  const base = chatBaseUrl(address);
  if (!base) return "Enter an address that starts with http:// or https://.";
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {
    return "Enter an address that starts with http:// or https://.";
  }
  if (!isLoopbackHost(host)) return "Use an address on this computer, such as http://localhost:11434.";
  return null;
}

export function endpointAddressError(address: string): string | null {
  if (!chatBaseUrl(address)) return "Enter an address that starts with http:// or https://.";
  return null;
}

export type ProbeRequest =
  | { kind: "local"; baseUrl: string; model: string }
  | { kind: "ocr"; baseUrl: string; model: string }
  | { kind: "endpoint"; baseUrl: string; model: string; apiKey: string };

export function parseProbeRequest(
  body: Record<string, unknown>,
): { ok: true; value: ProbeRequest } | { ok: false; error: string } {
  const type = body.type;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!modelNameOk(model)) return { ok: false, error: "Enter a model name such as qwen3.5:9b." };
  if (type === "local" || type === "ocr") {
    const address = typeof body.address === "string" ? body.address : "";
    const addressError = localAddressError(address);
    if (addressError) return { ok: false, error: addressError };
    const baseUrl = chatBaseUrl(address) as string;
    if (type === "ocr") return { ok: true, value: { kind: "ocr", baseUrl, model } };
    return { ok: true, value: { kind: "local", baseUrl, model } };
  }
  if (type === "endpoint") {
    const address = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const addressError = endpointAddressError(address);
    if (addressError) return { ok: false, error: addressError };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 500) return { ok: false, error: "Enter the key for this endpoint." };
    return {
      ok: true,
      value: { kind: "endpoint", baseUrl: chatBaseUrl(address) as string, model, apiKey },
    };
  }
  return { ok: false, error: "Choose where the assistant should think." };
}

/** A chat or PDF body. `{ apiKey }` alone is still OpenAI. */
export function parseAssistantTarget(
  body: Record<string, unknown>,
): { ok: true; value: AssistantTarget } | { ok: false; error: string } {
  if (body.assistant === undefined) {
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (!looksLikeOpenAiKey(apiKey)) return { ok: false, error: "Add an OpenAI key in setup." };
    return { ok: true, value: { type: "openai", apiKey } };
  }
  if (typeof body.assistant !== "object" || body.assistant === null || Array.isArray(body.assistant)) {
    return { ok: false, error: "Add an assistant in setup." };
  }
  const row = body.assistant as Record<string, unknown>;
  if (row.type === "openai") {
    const apiKey = typeof row.apiKey === "string" ? row.apiKey : "";
    if (!looksLikeOpenAiKey(apiKey)) return { ok: false, error: "Add an OpenAI key in setup." };
    return { ok: true, value: { type: "openai", apiKey } };
  }
  if (row.type === "local") {
    const address = typeof row.baseUrl === "string" ? row.baseUrl : "";
    const model = typeof row.model === "string" ? row.model.trim() : "";
    const addressError = localAddressError(address);
    if (addressError) return { ok: false, error: addressError };
    if (!modelNameOk(model)) return { ok: false, error: "Enter a model name such as qwen3.5:9b." };
    const ocrModel = optionalModel(row.ocrModel);
    if (ocrModel === "invalid") return { ok: false, error: "Enter an OCR model name such as glm-ocr." };
    return {
      ok: true,
      value: { type: "local", baseUrl: chatBaseUrl(address) as string, model, ocrModel },
    };
  }
  if (row.type === "endpoint") {
    const address = typeof row.baseUrl === "string" ? row.baseUrl : "";
    const model = typeof row.model === "string" ? row.model.trim() : "";
    const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim() : "";
    const addressError = endpointAddressError(address);
    if (addressError) return { ok: false, error: addressError };
    if (!modelNameOk(model)) return { ok: false, error: "Enter a model name." };
    if (!apiKey || apiKey.length > 500) return { ok: false, error: "Enter the key for this endpoint." };
    return {
      ok: true,
      value: { type: "endpoint", baseUrl: chatBaseUrl(address) as string, model, apiKey },
    };
  }
  return { ok: false, error: "Add an assistant in setup." };
}

export function scrubSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("");
}

export { LOCAL_NUM_CTX };
