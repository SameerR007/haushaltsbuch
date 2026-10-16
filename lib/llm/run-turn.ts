import {
  APICallError,
  generateText,
  hasToolCall,
  InvalidToolInputError,
  isStepCount,
  ToolChoiceViolationError,
  type ModelMessage,
} from "ai";
import { endpointPdfReadError } from "@/lib/assistant/copy";
import type { AssistantTarget } from "@/lib/assistant/target";
import { CHAT_REASONING_EFFORT, resolveChatModel } from "@/lib/chat/openai";
import type { ChatTurn } from "@/lib/chat/types";
import { resolveModel, stubGroceryRow, stubRentRow, stubSalaryRow } from "./models";
import { argumentsLookWrong, createChatTools, invalidArgumentsInput, type ToolHandler } from "./tools";

export { stubGroceryRow, stubRentRow, stubSalaryRow };
export type { ToolHandler };

const STEP_LIMIT = 4;
const REPLY_CAP = 8_000;
const STEP_TIMEOUT_MS = 120_000;

export class OpenAiError extends Error {
  readonly fileRejected: boolean;

  constructor(message: string, options?: { fileRejected?: boolean }) {
    super(message);
    this.name = "OpenAiError";
    this.fileRejected = options?.fileRejected === true;
  }
}

/** Attachment shape kept for the key check. The live request is a file part and does not send `detail`. */
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

function toSdkMessages(
  messages: ChatTurn[],
  pdf: { filename: string; data: Buffer } | undefined,
  nativePdf: boolean,
): ModelMessage[] {
  return messages.map((message, index) => {
    const last = index === messages.length - 1;
    if (nativePdf && pdf && last && message.role === "user") {
      return {
        role: "user",
        content: [
          {
            type: "file",
            data: pdf.data,
            mediaType: "application/pdf",
            filename: pdf.filename,
          },
          { type: "text", text: message.content },
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

function stepText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function finishReply(reply: string, apiKey: string, proposalArgs: unknown): { reply: string; proposalArgs: unknown | null } {
  let text = reply;
  if (apiKey) text = text.split(apiKey).join("").trim();
  return { reply: text.slice(0, REPLY_CAP), proposalArgs };
}

function isTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.name === "TimeoutError" || current.name === "AbortError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function mapFailure(
  error: unknown,
  failure: { timeout: string; failed: string; unreachable: string },
  context: { pdf: boolean; assistant: AssistantTarget },
): OpenAiError {
  if (error instanceof OpenAiError) return error;
  if (
    context.pdf &&
    context.assistant.type === "endpoint" &&
    APICallError.isInstance(error) &&
    error.statusCode === 400
  ) {
    return new OpenAiError(endpointPdfReadError(context.assistant.model), { fileRejected: true });
  }
  if (isTimeout(error)) return new OpenAiError(failure.timeout);
  if (APICallError.isInstance(error)) {
    if (isTimeout(error.cause)) return new OpenAiError(failure.timeout);
    if (error.statusCode != null) return new OpenAiError(failure.failed);
    return new OpenAiError(failure.unreachable);
  }
  return new OpenAiError(failure.unreachable);
}

function unparsable(input: string): boolean {
  try {
    JSON.parse(input);
    return false;
  } catch {
    return true;
  }
}

export async function runChatTurn(options: {
  apiKey: string;
  assistant?: AssistantTarget;
  instructions: string;
  messages: ChatTurn[];
  mode: "chat" | "pdf";
  pdf?: { filename: string; data: Buffer };
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  executeTool: ToolHandler;
}): Promise<{ reply: string; proposalArgs: unknown | null }> {
  const assistant: AssistantTarget = options.assistant ?? { type: "openai", apiKey: options.apiKey };
  const resolved = resolveModel({
    assistant,
    modelId: assistant.type === "openai" ? resolveChatModel() : assistant.model,
    reasoningEffort: CHAT_REASONING_EFFORT,
    fetchImpl: options.fetchImpl,
  });
  let proposalArgs: unknown = null;
  const tools = createChatTools({
    executeTool: options.executeTool,
    onPropose: (args) => {
      proposalArgs = args;
    },
    validateShape: resolved.validateToolArgs,
  });
  const pdfMode = options.mode === "pdf";
  let malformedRetries = resolved.retryMalformedTools ? 1 : 0;
  const secret =
    options.apiKey || (assistant.type === "openai" || assistant.type === "endpoint" ? assistant.apiKey : "");

  try {
    const result = await generateText({
      model: resolved.model,
      instructions: options.instructions,
      messages: toSdkMessages(options.messages, options.pdf, resolved.nativePdf),
      tools,
      toolChoice: "auto",
      activeTools: pdfMode ? ["propose_transactions"] : undefined,
      stopWhen: pdfMode
        ? [isStepCount(STEP_LIMIT), hasToolCall("propose_transactions")]
        : isStepCount(STEP_LIMIT),
      prepareStep: ({ stepNumber }) =>
        pdfMode && stepNumber === 0
          ? { toolChoice: { type: "tool", toolName: "propose_transactions" } }
          : { toolChoice: "auto" },
      repairToolCall: async ({ toolCall, error }) => {
        if (!InvalidToolInputError.isInstance(error)) return null;
        const wrong = resolved.validateToolArgs
          ? argumentsLookWrong(toolCall.toolName, toolCall.input)
          : unparsable(toolCall.input);
        if (!wrong) return null;
        if (malformedRetries > 0) {
          malformedRetries -= 1;
          return null;
        }
        return { ...toolCall, input: invalidArgumentsInput() };
      },
      providerOptions: resolved.providerOptions,
      maxRetries: 0,
      abortSignal: options.signal,
      timeout: { stepMs: STEP_TIMEOUT_MS },
    });

    let reply = "";
    for (const step of result.steps) {
      const text = stepText(step.content);
      if (text) reply = text;
    }
    return finishReply(reply, secret, proposalArgs);
  } catch (error) {
    if (ToolChoiceViolationError.isInstance(error)) {
      const text = stepText(
        error.content.filter((part): part is { type: "text"; text: string } => part.type === "text"),
      );
      return finishReply(text, secret, proposalArgs);
    }
    if (options.signal?.aborted) {
      const cancelled = new Error("Cancelled");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    throw mapFailure(error, resolved.failure, { pdf: pdfMode, assistant });
  }
}
