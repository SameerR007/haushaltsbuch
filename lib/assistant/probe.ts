import {
  answeredDetail,
  CONNECTED_TITLE,
  EMPTY_REPLY_DETAIL,
  EMPTY_REPLY_TITLE,
  ENDPOINT_ERROR_TITLE,
  ENDPOINT_KEY_DETAIL,
  ENDPOINT_KEY_TITLE,
  ENDPOINT_MISSING_DETAIL,
  ENDPOINT_MISSING_TITLE,
  ENDPOINT_NO_TOOLS_DETAIL,
  ENDPOINT_NO_TOOLS_TITLE,
  ENDPOINT_UNREACHABLE_DETAIL,
  ENDPOINT_UNREACHABLE_TITLE,
  formatSeconds,
  LOCAL_NUM_CTX,
  MODEL_MISSING_DETAIL,
  MODEL_MISSING_TITLE,
  NO_TOOLS_DETAIL,
  NO_TOOLS_TITLE,
  OLLAMA_ERROR_TITLE,
  OLLAMA_NOT_RUNNING_DETAIL,
  OLLAMA_NOT_RUNNING_TITLE,
  OLLAMA_SERVE_COMMAND,
  pullCommand,
  serviceErrorDetail,
  SLOW_PROBE_MS,
  SLOW_TITLE,
  slowDetail,
} from "./copy";
import { withReasoningOff } from "../llm/reasoning-off";
import type { ProbeRequest } from "./target";

export type ProbeSuccess = {
  ok: true;
  status: "connected" | "slow";
  title: string;
  detail: string;
  seconds: number;
};

export type ProbeFailure = {
  ok: false;
  status: "unreachable" | "missing" | "no-tools" | "refused" | "error" | "empty";
  title: string;
  detail: string;
  command?: string;
};

export type ProbeOutcome = ProbeSuccess | ProbeFailure;

const PROBE_TIMEOUT_MS = 45_000;

/** The OCR check is answered by `checkImageCapability`, not here. */
export async function probeAssistant(
  request: Exclude<ProbeRequest, { kind: "ocr" }>,
  options?: { fetchImpl?: typeof fetch; now?: () => number },
): Promise<ProbeOutcome> {
  const baseFetch = options?.fetchImpl ?? fetch;
  // Same reasoning-off request the endpoint chat sends, so the test passes exactly when chat would work.
  const fetchImpl = request.kind === "endpoint" ? withReasoningOff(baseFetch) : baseFetch;
  const now = options?.now ?? Date.now;
  const kind = request.kind;
  const headers = probeHeaders(request);

  const listed = await listModels(request.baseUrl, headers, fetchImpl);
  if (listed === "down") return unreachable(kind);
  if (listed === "refused") return refused(kind);
  if (isServiceError(listed)) return serviceError(kind, listed);
  if (listed !== "unknown" && !modelListed(listed, request.model)) return missing(kind, request.model);

  const started = now();
  const chat = await postChat(request, headers, fetchImpl, false);
  const elapsed = Math.max(0, now() - started);
  if (chat === "down") return unreachable(kind);
  if (chat === "refused") return refused(kind);
  if (chat === "missing") return missing(kind, request.model);
  if (isServiceError(chat)) return serviceError(kind, chat);
  if (chat === "empty") return emptyReply();

  const tools = await postChat(request, headers, fetchImpl, true);
  if (tools === "down") return unreachable(kind);
  if (tools === "refused") return refused(kind);
  if (tools === "missing") return missing(kind, request.model);
  if (isServiceError(tools)) return serviceError(kind, tools);
  if (tools !== "tools") return noTools(kind);

  const secondsLabel = formatSeconds(elapsed);
  const seconds = Number(secondsLabel);
  if (elapsed > SLOW_PROBE_MS) {
    return {
      ok: true,
      status: "slow",
      title: SLOW_TITLE,
      detail: slowDetail(kind, request.model, secondsLabel),
      seconds,
    };
  }
  return {
    ok: true,
    status: "connected",
    title: CONNECTED_TITLE,
    detail: answeredDetail(kind, request.model, secondsLabel),
    seconds,
  };
}

function probeHeaders(request: ProbeRequest): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (request.kind === "endpoint") headers.authorization = `Bearer ${request.apiKey}`;
  return headers;
}

function unreachable(kind: ProbeRequest["kind"]): ProbeFailure {
  if (kind === "endpoint") {
    return {
      ok: false,
      status: "unreachable",
      title: ENDPOINT_UNREACHABLE_TITLE,
      detail: ENDPOINT_UNREACHABLE_DETAIL,
    };
  }
  return {
    ok: false,
    status: "unreachable",
    title: OLLAMA_NOT_RUNNING_TITLE,
    detail: OLLAMA_NOT_RUNNING_DETAIL,
    command: OLLAMA_SERVE_COMMAND,
  };
}

function refused(kind: ProbeRequest["kind"]): ProbeFailure {
  if (kind === "endpoint") {
    return { ok: false, status: "refused", title: ENDPOINT_KEY_TITLE, detail: ENDPOINT_KEY_DETAIL };
  }
  return unreachable(kind);
}

function missing(kind: ProbeRequest["kind"], model: string): ProbeFailure {
  if (kind === "endpoint") {
    return { ok: false, status: "missing", title: ENDPOINT_MISSING_TITLE, detail: ENDPOINT_MISSING_DETAIL };
  }
  return {
    ok: false,
    status: "missing",
    title: MODEL_MISSING_TITLE,
    detail: MODEL_MISSING_DETAIL,
    command: pullCommand(model),
  };
}

function noTools(kind: ProbeRequest["kind"]): ProbeFailure {
  if (kind === "endpoint") {
    return { ok: false, status: "no-tools", title: ENDPOINT_NO_TOOLS_TITLE, detail: ENDPOINT_NO_TOOLS_DETAIL };
  }
  return { ok: false, status: "no-tools", title: NO_TOOLS_TITLE, detail: NO_TOOLS_DETAIL };
}

/** The service answered, but with an error. Its own message says more than "couldn't reach". */
type ServiceError = { error: string | null; status: number };

function isServiceError(value: unknown): value is ServiceError {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "status" in value;
}

function serviceError(kind: ProbeRequest["kind"], failure: ServiceError): ProbeFailure {
  return {
    ok: false,
    status: "error",
    title: kind === "endpoint" ? ENDPOINT_ERROR_TITLE : OLLAMA_ERROR_TITLE,
    detail: serviceErrorDetail(failure.error, failure.status),
  };
}

function emptyReply(): ProbeFailure {
  return { ok: false, status: "empty", title: EMPTY_REPLY_TITLE, detail: EMPTY_REPLY_DETAIL };
}

function errorMessage(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { error?: unknown; message?: unknown }).error ?? (payload as { message?: unknown }).message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

type ListResult = "down" | "refused" | "unknown" | ServiceError | string[];

async function listModels(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<ListResult> {
  const response = await call(`${baseUrl}/models`, { method: "GET", headers }, fetchImpl);
  if (response === "down") return "down";
  if (response === "refused") return "refused";
  if (response.status === 404 || response.status === 405) return "unknown";
  if (!response.ok) return { error: errorMessage(response.json), status: response.status };
  return modelIds(response.json);
}

type CallResult = "down" | "refused" | { ok: boolean; status: number; json: unknown };

async function call(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<CallResult> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) return "down";
    if (response.status === 401 || response.status === 403) return "refused";
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

type ChatMark = "ok" | "tools" | "down" | "refused" | "missing" | "empty" | ServiceError;

async function postChat(
  request: ProbeRequest,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  tools: boolean,
): Promise<ChatMark> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      {
        role: "user",
        content: tools ? "Call the ping tool." : "Reply with ok.",
      },
    ],
  };
  // Hosted models may reject max_tokens (newer OpenAI models want max_completion_tokens),
  // and a reasoning model can spend a small limit before it answers. Only Ollama gets one.
  if (request.kind === "local") {
    body.max_tokens = 16;
    body.reasoning_effort = "none";
    body.options = { num_ctx: LOCAL_NUM_CTX };
  }
  if (tools) {
    body.tools = [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Confirm that tool calls work.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ];
    body.tool_choice = { type: "function", function: { name: "ping" } };
  }
  const response = await call(
    `${request.baseUrl}/chat/completions`,
    { method: "POST", headers, body: JSON.stringify(body) },
    fetchImpl,
  );
  if (response === "down") return "down";
  if (response === "refused") return "refused";
  if (response.status === 404 || mentionsMissing(response.json)) return "missing";
  if (!response.ok) return { error: errorMessage(response.json), status: response.status };
  if (tools) return calledPing(response.json) ? "tools" : "empty";
  return hasAnswer(response.json) ? "ok" : "empty";
}

function modelIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const row = payload as { data?: unknown; models?: unknown };
  const ids: string[] = [];
  const lists = [row.data, row.models];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") {
        ids.push(item);
        continue;
      }
      if (typeof item !== "object" || item === null) continue;
      const record = item as { id?: unknown; name?: unknown; model?: unknown };
      if (typeof record.id === "string") ids.push(record.id);
      if (typeof record.name === "string") ids.push(record.name);
      if (typeof record.model === "string") ids.push(record.model);
    }
  }
  return ids;
}

function modelListed(ids: string[], model: string): boolean {
  return ids.some((id) => id === model || id === `${model}:latest` || model === `${id}:latest`);
}

function mentionsMissing(payload: unknown): boolean {
  const text = JSON.stringify(payload ?? "").toLowerCase();
  return text.includes("not found") || text.includes("does not exist") || text.includes("unknown model");
}

function hasAnswer(payload: unknown): boolean {
  const message = firstMessage(payload);
  if (!message) return false;
  return typeof message.content === "string" && message.content.trim().length > 0;
}

function calledPing(payload: unknown): boolean {
  const message = firstMessage(payload);
  if (!message || !Array.isArray(message.tool_calls)) return false;
  return message.tool_calls.some((call) => {
    if (typeof call !== "object" || call === null) return false;
    const fn = (call as { function?: { name?: unknown } }).function;
    return fn?.name === "ping";
  });
}

function firstMessage(payload: unknown): { content?: unknown; tool_calls?: unknown } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  return message as { content?: unknown; tool_calls?: unknown };
}
