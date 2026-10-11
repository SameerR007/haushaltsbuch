/** GPT-5.6 Luna. HAUSHALTSBUCH_CHAT_MODEL overrides this for the process. */
export const CHAT_MODEL = "gpt-5.6-luna";

export function resolveChatModel(): string {
  const override = process.env.HAUSHALTSBUCH_CHAT_MODEL?.trim();
  if (override && override.length <= 80 && !/\s/.test(override)) return override;
  return CHAT_MODEL;
}

export const CHAT_REASONING_EFFORT = "high" as const;

export {
  OpenAiError,
  runChatTurn,
  stubGroceryRow,
  stubRentRow,
  stubSalaryRow,
  toModelInput,
} from "@/lib/llm/run-turn";

export type { ToolHandler } from "@/lib/llm/run-turn";
