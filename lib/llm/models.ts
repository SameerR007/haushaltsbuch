import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { previousMonthIso } from "@/lib/chat/prompts";

export type ResolvedModel = {
  model: LanguageModel;
  providerOptions: {
    openai: {
      store: false;
      include: ["reasoning.encrypted_content"];
      reasoningEffort: string;
      reasoningSummary: null;
    };
  };
  nativePdf: boolean;
};

/**
 * OpenAI only. A later milestone adds the local model here; the turn loop
 * reads `model`, `providerOptions`, and `nativePdf` and does not branch on
 * the provider name.
 */
export function resolveModel(options: {
  apiKey: string;
  modelId: string;
  reasoningEffort: string;
  fetchImpl?: typeof fetch;
}): ResolvedModel {
  const inner =
    process.env.HAUSHALTSBUCH_STUB_OPENAI === "1"
      ? createStubFetch()
      : (options.fetchImpl ?? fetch);
  const openai = createOpenAI({
    apiKey: options.apiKey,
    fetch: withOpenAiResponseCompat(inner),
  });
  return {
    model: openai.responses(options.modelId),
    providerOptions: {
      openai: {
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoningEffort: options.reasoningEffort,
        // The SDK otherwise adds reasoning.summary "detailed". Today's body is effort only.
        reasoningSummary: null,
      },
    },
    nativePdf: true,
  };
}

export function stubGroceryRow(now = new Date()) {
  return {
    date: previousMonthIso(12, now),
    description: "Groceries",
    category: "grocery",
    bank: "",
    amount: -12.5,
    uncertain: false,
  };
}

export function stubRentRow(now = new Date()) {
  return {
    date: previousMonthIso(3, now),
    description: "City Landlord — rent",
    category: "rent",
    bank: "",
    amount: -850,
    uncertain: false,
  };
}

export function stubSalaryRow(now = new Date()) {
  return {
    date: previousMonthIso(28, now),
    description: "Salary",
    category: "salary",
    bank: "",
    amount: 2850,
    uncertain: false,
  };
}

type ModelResponse = {
  id?: string;
  output?: unknown[];
};

function stubDelayMs(body: string): number {
  if (!body.includes("input_file")) return 0;
  if (process.env.HAUSHALTSBUCH_STUB_DELAY_MS === "0") return 0;
  return 1200;
}

function createStubFetch(): typeof fetch {
  return async (_input, init) => {
    const body = String(init?.body ?? "");
    const delay = stubDelayMs(body);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    let payload: unknown = {};
    try {
      payload = JSON.parse(body);
    } catch {
      payload = {};
    }
    const input =
      typeof payload === "object" && payload !== null && "input" in payload
        ? (payload as { input: unknown }).input
        : [];
    return Response.json(stubModel(input));
  };
}

function inputHasFile(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  return input.some((item) => {
    if (typeof item !== "object" || item === null || !("content" in item)) return false;
    const content = (item as { content: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: string }).type === "input_file",
      )
    );
  });
}

function lastUserText(input: unknown): string {
  if (!Array.isArray(input)) return "";
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (typeof item !== "object" || item === null) continue;
    const record = item as { role?: string; content?: unknown };
    if (record.role !== "user") continue;
    if (typeof record.content === "string") return record.content;
    if (Array.isArray(record.content)) {
      const text = record.content.find(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: string }).type === "input_text",
      ) as { text?: string } | undefined;
      if (text?.text) return text.text;
    }
  }
  return "";
}

function stubModel(input: unknown): ModelResponse {
  const items = Array.isArray(input) ? input : [];
  const followup = items.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: string }).type === "function_call_output",
  );
  if (followup) {
    const blob = items
      .map((item) =>
        typeof item === "object" && item !== null && "output" in item
          ? String((item as { output?: unknown }).output ?? "")
          : "",
      )
      .join("\n");
    const text = blob.includes('"total"')
      ? `Queried the household database. Rows: ${blob}`
      : "Nothing is saved yet — check the rows first.";
    return {
      id: "resp_stub_text",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      ],
    };
  }
  if (inputHasFile(input)) {
    return toolResponse("propose_transactions", {
      rows: [stubGroceryRow(), stubRentRow(), stubSalaryRow()],
    });
  }
  if (lastUserText(input).trim().endsWith("?")) {
    return toolResponse("run_sql", {
      query: "SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM transactions",
    });
  }
  return toolResponse("propose_transactions", { rows: [stubGroceryRow()] });
}

function toolResponse(name: string, args: unknown): ModelResponse {
  return {
    id: `resp_stub_${name}`,
    output: [
      {
        type: "function_call",
        call_id: `call_stub_${name}`,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
}

/**
 * Test doubles and the old stub return a short Responses body. The SDK schema
 * requires a few fields the fixtures omit (`id`, `role`, `annotations`).
 * Fill those in when they are missing so the same JSON still parses.
 */
function withOpenAiResponseCompat(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, { ...init, cache: "no-store" });
    const raw = await response.text();
    const headers = {
      "content-type": response.headers.get("content-type") ?? "application/json",
    };
    if (!response.ok) {
      return new Response(raw, { status: response.status, statusText: response.statusText, headers });
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return new Response(JSON.stringify(normalizeResponsesPayload(parsed)), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return new Response(raw, { status: response.status, headers });
    }
  };
}

function normalizeResponsesPayload(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || !("output" in payload)) return payload;
  const record = payload as { output?: unknown };
  if (!Array.isArray(record.output)) return payload;
  return {
    ...record,
    output: record.output.map((item, index) => normalizeOutputItem(item, index)),
  };
}

function normalizeOutputItem(item: unknown, index: number): unknown {
  if (typeof item !== "object" || item === null) return item;
  const record = item as Record<string, unknown>;
  if (record.type === "function_call") {
    const callId = typeof record.call_id === "string" ? record.call_id : `call_${index}`;
    return { ...record, call_id: record.call_id ?? callId, id: typeof record.id === "string" ? record.id : callId };
  }
  if (record.type === "message") {
    const content = Array.isArray(record.content)
      ? record.content.map((part) => {
          if (typeof part !== "object" || part === null) return part;
          const piece = part as Record<string, unknown>;
          if (piece.type === "output_text" && !Array.isArray(piece.annotations)) {
            return { ...piece, annotations: [] };
          }
          return part;
        })
      : record.content;
    return {
      ...record,
      id: typeof record.id === "string" ? record.id : `msg_${index}`,
      role: record.role ?? "assistant",
      content,
    };
  }
  if (record.type === "reasoning") {
    return {
      ...record,
      id: typeof record.id === "string" ? record.id : `rs_${index}`,
      summary: Array.isArray(record.summary) ? record.summary : [],
    };
  }
  return item;
}
