import { loadHousehold } from "@/lib/chat/household";
import { OpenAiError, runChatTurn } from "@/lib/chat/openai";
import { householdInstructions, todayIso } from "@/lib/chat/prompts";
import { executeReadOnlyQuery } from "@/lib/chat/sql-guard";
import type { ChatTurn, Proposal } from "@/lib/chat/types";
import { reviewProposedRows, rowsOf } from "@/lib/chat/validate-rows";
import { looksLikeOpenAiKey } from "@/lib/setup/guards";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The OpenAI key arrives on this request and is sent only as a bearer token.
// Do not store it, log it, or put it in the response.

function invalid(error: string): Response {
  return jsonResult({ ok: false, code: "invalid", error }, 400);
}

function parseMessages(value: unknown): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return null;
  const messages: ChatTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") return null;
    if (typeof record.content !== "string" || record.content.length > 8000) return null;
    messages.push({ role: record.role, content: record.content });
  }
  if (messages[messages.length - 1]?.role !== "user") return null;
  return messages;
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return invalid("That request is too large.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid("Invalid request.");
    }
    if (typeof body !== "object" || body === null) return invalid("Invalid request.");
    const record = body as { apiKey?: unknown; messages?: unknown };
    if (typeof record.apiKey !== "string" || !looksLikeOpenAiKey(record.apiKey)) {
      return invalid("Add an OpenAI key in setup.");
    }
    const messages = parseMessages(record.messages);
    if (!messages) return invalid("Send a message.");
    const apiKey = record.apiKey;

    const household = loadHousehold();
    const instructions = householdInstructions({
      currency: household.currency,
      categories: household.categories,
      banks: household.banks,
      today: todayIso(),
    });
    let proposalArgs: unknown = null;
    const result = await runChatTurn({
      apiKey,
      instructions,
      messages,
      mode: "chat",
      executeTool: (name, args) => {
        if (name === "run_sql") {
          const query =
            typeof args === "object" &&
            args !== null &&
            "query" in args &&
            typeof (args as { query: unknown }).query === "string"
              ? (args as { query: string }).query
              : "";
          return executeReadOnlyQuery(query);
        }
        if (name === "propose_transactions") {
          proposalArgs = args;
          return {
            ok: true,
            saved: false,
            count: reviewProposedRows(rowsOf(args), household).length,
          };
        }
        return { ok: false, error: "Unknown tool." };
      },
    });

    const rows = proposalArgs ? reviewProposedRows(rowsOf(proposalArgs), household) : [];
    const proposal: Proposal | null = rows.length
      ? {
          sourceName: null,
          currency: household.currency,
          categories: household.categories,
          banks: household.banks,
          rows,
        }
      : null;
    return jsonResult({ ok: true, reply: result.reply, proposal }, 200);
  } catch (error) {
    const message = error instanceof OpenAiError ? error.message : "Could not answer that.";
    return jsonResult({ ok: false, code: "rejected", error: message }, 422);
  }
}
