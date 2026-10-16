import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";

/**
 * Optional Langfuse tracing. Off unless LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are set when the server starts. When off, every helper
 * here runs the callback directly and nothing leaves this computer.
 */
export function tracingEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim());
}

type Flushable = { forceFlush(): Promise<void> };

const PROCESSOR_KEY = "__haushaltsbuchLangfuseProcessor";

/** instrumentation.ts and the route bundles are separate modules; the processor is shared through globalThis. */
export function setTraceProcessor(processor: Flushable): void {
  (globalThis as Record<string, unknown>)[PROCESSOR_KEY] = processor;
}

function traceProcessor(): Flushable | null {
  return ((globalThis as Record<string, unknown>)[PROCESSOR_KEY] as Flushable | undefined) ?? null;
}

/** Send buffered spans now. A failed export never fails the request. */
export async function flushTraces(): Promise<void> {
  try {
    await traceProcessor()?.forceFlush();
  } catch {
    // Tracing is best-effort.
  }
}

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

function redactString(value: string): string {
  let text = value;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text;
}

/** Applied to every span attribute before export. Keys never reach Langfuse even if one slips into a prompt. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (ArrayBuffer.isView(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = redactSecrets(entry, depth + 1);
  return out;
}

export type TraceAttributes = {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
};

export type Observation = { update(attributes: TraceAttributes): unknown };

const NOOP: Observation = { update: () => undefined };

function failure(error: unknown): TraceAttributes {
  return {
    level: "ERROR",
    statusMessage: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Failed",
  };
}

/** One trace per request: the root `agent` observation, grouped by the browser's chat session. */
export async function withTrace<T>(
  options: {
    name: string;
    sessionId?: string | null;
    tags?: string[];
    input?: unknown;
    metadata?: Record<string, unknown>;
  },
  run: (root: Observation) => Promise<T>,
): Promise<T> {
  if (!tracingEnabled()) return run(NOOP);
  try {
    return await propagateAttributes(
      {
        traceName: options.name,
        sessionId: options.sessionId ?? undefined,
        tags: options.tags,
      },
      () =>
        startActiveObservation(
          options.name,
          async (root) => {
            root.update({ input: options.input, metadata: options.metadata });
            try {
              return await run(root);
            } catch (error) {
              root.update(failure(error));
              throw error;
            }
          },
          { asType: "agent" },
        ),
    );
  } finally {
    await flushTraces();
  }
}

/** A child observation inside the active trace, such as the SQL guard or the query process. */
export async function withSpan<T>(
  name: string,
  asType: "span" | "tool" | "guardrail",
  input: unknown,
  run: (span: Observation) => Promise<T> | T,
): Promise<T> {
  if (!tracingEnabled()) return run(NOOP);
  const body = async (span: Observation) => {
    span.update({ input });
    try {
      return await run(span);
    } catch (error) {
      span.update(failure(error));
      throw error;
    }
  };
  if (asType === "tool") return startActiveObservation(name, body, { asType: "tool" });
  if (asType === "guardrail") return startActiveObservation(name, body, { asType: "guardrail" });
  return startActiveObservation(name, body);
}

/** The browser's chat session id groups turns in Langfuse. Anything else is dropped. */
export function traceSessionId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}
