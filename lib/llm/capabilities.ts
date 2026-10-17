import {
  OCR_BLIND_DETAIL,
  OCR_MISSING_DETAIL,
  OCR_UNREACHABLE_DETAIL,
  OCR_UNREACHABLE_TITLE,
  ocrBlindTitle,
  ocrMissingTitle,
  ocrReadyTitle,
  pullCommand,
} from "@/lib/assistant/copy";

/**
 * Light vision check. No image is sent.
 * Ollama: POST {origin}/api/show, `capabilities` includes "vision".
 * LM Studio: GET {baseUrl}/models, model `type` is "vlm".
 */
export type ImageCapability =
  | { status: "ready" }
  | { status: "missing"; command?: string }
  | { status: "blind" }
  | { status: "unreachable" };

export type OcrProbeView = {
  ok: boolean;
  status: "ready" | "missing" | "blind" | "unreachable";
  title: string;
  detail?: string;
  command?: string;
};

const CHECK_TIMEOUT_MS = 10_000;

export async function checkImageCapability(options: {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<ImageCapability> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model.trim();
  let origin = "";
  try {
    origin = new URL(options.baseUrl).origin;
  } catch {
    return { status: "unreachable" };
  }

  const show = await call(
    `${origin}/api/show`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) },
    fetchImpl,
  );
  if (show !== "down" && show.ok) {
    const capabilities = readCapabilities(show.json);
    if (capabilities) {
      return capabilities.includes("vision") ? { status: "ready" } : { status: "blind" };
    }
  }
  if (show !== "down" && show.status === 404 && ollamaMissing(show.json)) {
    return { status: "missing", command: pullCommand(model) };
  }

  const listed = await call(`${stripSlash(options.baseUrl)}/models`, { method: "GET" }, fetchImpl);
  if (listed === "down" || !listed.ok) return { status: "unreachable" };
  const models = readModels(listed.json);
  if (!models) return { status: "unreachable" };
  const found = models.find((entry) => modelMatches(entry.id, model));
  if (!found) return { status: "missing" };
  if (found.type === "vlm" || found.capabilities.includes("vision")) return { status: "ready" };
  return { status: "blind" };
}

export function describeImageCapability(model: string, result: ImageCapability): OcrProbeView {
  if (result.status === "ready") {
    return { ok: true, status: "ready", title: ocrReadyTitle(model) };
  }
  if (result.status === "missing") {
    if (result.command) {
      return {
        ok: false,
        status: "missing",
        title: ocrMissingTitle(model),
        detail: OCR_MISSING_DETAIL,
        command: result.command,
      };
    }
    return {
      ok: false,
      status: "missing",
      title: ocrMissingTitle(model),
      detail: "Check the model name, then test again.",
    };
  }
  if (result.status === "blind") {
    return { ok: false, status: "blind", title: ocrBlindTitle(model), detail: OCR_BLIND_DETAIL };
  }
  return {
    ok: false,
    status: "unreachable",
    title: OCR_UNREACHABLE_TITLE,
    detail: OCR_UNREACHABLE_DETAIL,
  };
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

type CallResult = "down" | { ok: boolean; status: number; json: unknown };

async function call(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<CallResult> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) return "down";
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json };
  } catch {
    return "down";
  }
}

function readCapabilities(payload: unknown): string[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const capabilities = (payload as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return null;
  const names = capabilities.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
  return names;
}

function ollamaMissing(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "string") return false;
  const text = error.toLowerCase();
  return text.includes("not found") || text.includes("does not exist");
}

type ListedModel = { id: string; type: string; capabilities: string[] };

function readModels(payload: unknown): ListedModel[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const models: ListedModel[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { id?: unknown; type?: unknown; capabilities?: unknown };
    if (typeof record.id !== "string" || !record.id.trim()) continue;
    const capabilities = Array.isArray(record.capabilities)
      ? record.capabilities.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase())
      : [];
    models.push({
      id: record.id.trim(),
      type: typeof record.type === "string" ? record.type.trim().toLowerCase() : "",
      capabilities,
    });
  }
  return models;
}

function modelMatches(listed: string, model: string): boolean {
  return listed === model || listed === `${model}:latest` || model === `${listed}:latest`;
}
