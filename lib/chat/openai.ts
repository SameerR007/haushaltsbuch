import type { ChatTurn } from "./types";
import { previousMonthIso } from "./prompts";

/** Latest GPT-5.x flagship. Every money-chat and statement request uses this id. */
export const CHAT_MODEL = "gpt-5.6-sol";

export const CHAT_REASONING_EFFORT = "high" as const;

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiError";
  }
}

const SQL_TOOL = {
  type: "function",
  name: "run_sql",
  description:
    "Run one read-only SELECT or WITH query against the household SQLite database. Call this before stating any amount, total, balance, or count. Results are capped at about 200 rows.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "A single SELECT or WITH … SELECT statement.",
      },
    },
    required: ["query"],
  },
} as const;

const PROPOSE_TOOL = {
  type: "function",
  name: "propose_transactions",
  description:
    "Propose transactions for the user to review. This does not save anything. Amounts are signed: expenses negative, income positive. Set uncertain to true when a field is unclear.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            description: { type: "string" },
            category: { type: "string" },
            bank: { type: "string" },
            amount: {
              type: "number",
              description: "Signed. Expenses negative, income positive.",
            },
            uncertain: { type: "boolean" },
          },
          required: ["date", "description", "category", "bank", "amount", "uncertain"],
        },
      },
    },
    required: ["rows"],
  },
} as const;

type ToolChoice = "auto" | { type: "function"; name: string };

type ModelResponse = {
  id?: string;
  output?: unknown[];
};

export type ToolHandler = (name: string, args: unknown) => unknown;

function toolsFor(mode: "chat" | "pdf") {
  return mode === "pdf" ? [PROPOSE_TOOL] : [SQL_TOOL, PROPOSE_TOOL];
}

function choiceFor(mode: "chat" | "pdf"): ToolChoice {
  return mode === "pdf" ? { type: "function", name: "propose_transactions" } : "auto";
}

export function toModelInput(
  messages: ChatTurn[],
  pdf?: { filename: string; data: Buffer },
): unknown[] {
  return messages.map((message, index) => {
    const last = index === messages.length - 1;
    if (pdf && last && message.role === "user") {
      return {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: pdf.filename,
            file_data: `data:application/pdf;base64,${pdf.data.toString("base64")}`,
            detail: "auto",
          },
          { type: "input_text", text: message.content },
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

export function buildResponsesPayload(input: {
  instructions: string;
  input: unknown;
  mode: "chat" | "pdf";
  toolChoice: ToolChoice;
  previousResponseId?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: CHAT_MODEL,
    reasoning: { effort: CHAT_REASONING_EFFORT },
    instructions: input.instructions,
    input: input.input,
    tools: toolsFor(input.mode),
    tool_choice: input.toolChoice,
  };
  if (input.previousResponseId) payload.previous_response_id = input.previousResponseId;
  return payload;
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
    return toolResponse("propose_transactions", { rows: [stubGroceryRow(), stubRentRow()] });
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

function readText(response: ModelResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { type?: string; content?: unknown };
    if (record.type !== "message" || !Array.isArray(record.content)) continue;
    for (const part of record.content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { type?: string; text?: string }).text;
      if ((part as { type?: string }).type === "output_text" && typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n").trim();
}

function readCalls(response: ModelResponse): { name: string; callId: string; args: unknown }[] {
  const calls: { name: string; callId: string; args: unknown }[] = [];
  for (const item of response.output ?? []) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { type?: string; name?: string; call_id?: string; arguments?: string };
    if (record.type !== "function_call" || !record.name || !record.call_id) continue;
    let args: unknown = null;
    try {
      args = record.arguments ? JSON.parse(record.arguments) : {};
    } catch {
      args = null;
    }
    calls.push({ name: record.name, callId: record.call_id, args });
  }
  return calls;
}

async function postResponses(input: {
  apiKey: string;
  payload: Record<string, unknown>;
  fetchImpl: typeof fetch;
}): Promise<ModelResponse> {
  let response: Response;
  try {
    response = await input.fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.payload),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new OpenAiError("OpenAI took too long. Try again.");
    }
    throw new OpenAiError("Could not reach OpenAI.");
  }
  const text = await response.text();
  if (!response.ok) throw new OpenAiError("OpenAI could not answer that.");
  try {
    return JSON.parse(text) as ModelResponse;
  } catch {
    throw new OpenAiError("OpenAI could not answer that.");
  }
}

function stubDelayMs(hasFile: boolean): number {
  if (!hasFile) return 0;
  if (process.env.HAUSHALTSBUCH_STUB_DELAY_MS === "0") return 0;
  return 1200;
}

export async function runChatTurn(options: {
  apiKey: string;
  instructions: string;
  messages: ChatTurn[];
  mode: "chat" | "pdf";
  pdf?: { filename: string; data: Buffer };
  fetchImpl?: typeof fetch;
  executeTool: ToolHandler;
}): Promise<{ reply: string; proposalArgs: unknown | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let input: unknown = toModelInput(options.messages, options.pdf);
  let previousId: string | undefined;
  let reply = "";
  let proposalArgs: unknown = null;
  const stub = process.env.HAUSHALTSBUCH_STUB_OPENAI === "1";

  for (let round = 0; round < 4; round += 1) {
    const payload = buildResponsesPayload({
      instructions: options.instructions,
      input,
      mode: options.mode,
      toolChoice: round === 0 ? choiceFor(options.mode) : "auto",
      previousResponseId: previousId,
    });
    let response: ModelResponse;
    if (stub) {
      const delay = stubDelayMs(inputHasFile(input));
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      response = stubModel(input);
    } else {
      response = await postResponses({ apiKey: options.apiKey, payload, fetchImpl });
    }
    const text = readText(response);
    if (text) reply = text;
    const calls = readCalls(response);
    if (calls.length === 0) break;
    const outputs: unknown[] = [];
    for (const call of calls) {
      if (call.args === null) {
        outputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify({ ok: false, error: "The arguments were not valid JSON." }),
        });
        continue;
      }
      if (call.name === "propose_transactions") proposalArgs = call.args;
      let result: unknown;
      try {
        result = options.executeTool(call.name, call.args);
      } catch {
        result = { ok: false, error: "The tool failed." };
      }
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result).slice(0, 80_000),
      });
    }
    if (options.mode === "pdf" && proposalArgs) break;
    previousId = response.id;
    input = outputs;
  }

  if (options.apiKey) reply = reply.split(options.apiKey).join("").trim();
  return { reply: reply.slice(0, 8000), proposalArgs };
}
