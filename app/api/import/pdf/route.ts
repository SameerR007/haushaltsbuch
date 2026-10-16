import { loadHousehold } from "@/lib/chat/household";
import { OpenAiError, runChatTurn } from "@/lib/chat/openai";
import {
  isPdfBytes,
  MAX_PDF_BYTES,
  PDF_NOT_PDF,
  PDF_TOO_LARGE,
  safePdfName,
} from "@/lib/chat/pdf-meta";
import { householdInstructions, MODEL_TURN_LIMIT, recentModelTurns, todayIso, withPdfInstructions } from "@/lib/chat/prompts";
import type { ChatTurn, Proposal } from "@/lib/chat/types";
import { reviewProposedRows, rowsOf } from "@/lib/chat/validate-rows";
import { LOCAL_IMPORT_SOON } from "@/lib/assistant/copy";
import { parseAssistantTarget } from "@/lib/assistant/target";
import { guardSameOrigin, jsonResult } from "@/lib/setup/http";
import { traceSessionId, withSpan, withTrace } from "@/lib/tracing/langfuse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The PDF and the OpenAI key are forwarded to OpenAI for this request only.
// The key is not stored or logged. Statement text is not extracted on this machine.

function invalid(error: string): Response {
  return jsonResult({ ok: false, code: "invalid", error }, 400);
}

function parseMessages(value: string | null): ChatTurn[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const messages: ChatTurn[] = [];
  for (const item of parsed.slice(-MODEL_TURN_LIMIT)) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.content !== "string" || record.content.length > 8000) continue;
    messages.push({ role: record.role, content: record.content });
  }
  return messages;
}

export async function POST(request: Request) {
  const blocked = guardSameOrigin(request);
  if (blocked) return blocked;
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_PDF_BYTES + 2_000_000) {
      return invalid(PDF_TOO_LARGE);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return invalid("Invalid request.");
    }
    const assistantField = form.get("assistant");
    const legacyKey = form.get("apiKey");
    let assistantBody: Record<string, unknown> = {};
    if (typeof assistantField === "string" && assistantField.trim()) {
      try {
        const parsed = JSON.parse(assistantField) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return invalid("Add an assistant in setup.");
        }
        assistantBody = { assistant: parsed };
      } catch {
        return invalid("Add an assistant in setup.");
      }
    } else if (typeof legacyKey === "string") {
      assistantBody = { apiKey: legacyKey };
    }
    const parsedAssistant = parseAssistantTarget(assistantBody);
    if (!parsedAssistant.ok) return invalid(parsedAssistant.error);
    const assistant = parsedAssistant.value;
    if (assistant.type === "local") return invalid(LOCAL_IMPORT_SOON);
    const apiKey = assistant.apiKey;
    const instruction = form.get("instruction");
    const file = form.get("file");
    if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 8000) {
      return invalid("Add an instruction for this statement.");
    }
    if (!(file instanceof Blob)) return invalid(PDF_NOT_PDF);
    if (file.size > MAX_PDF_BYTES) return invalid(PDF_TOO_LARGE);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(bytes)) return invalid(PDF_NOT_PDF);
    const filename = safePdfName(file instanceof File ? file.name : "statement.pdf");

    const household = loadHousehold();
    const prior = parseMessages(typeof form.get("messages") === "string" ? String(form.get("messages")) : null);
    const messages: ChatTurn[] = recentModelTurns([...prior, { role: "user", content: instruction.trim() }]);
    const rows = await withTrace(
      {
        name: "pdf-import",
        sessionId: traceSessionId(form.get("sessionId")),
        tags: ["pdf", assistant.type],
        input: { messages, statement: { filename, bytes: bytes.length } },
        metadata: { assistant: assistant.type, model: assistant.type === "openai" ? undefined : assistant.model },
      },
      async (root) => {
        let proposalArgs: unknown = null;
        await runChatTurn({
          apiKey,
          assistant,
          instructions: withPdfInstructions(
            householdInstructions({
              currency: household.currency,
              categories: household.categories,
              banks: household.banks,
              today: todayIso(),
            }),
          ),
          messages,
          mode: "pdf",
          pdf: { filename, data: Buffer.from(bytes) },
          executeTool: (name, args) => {
            if (name === "propose_transactions") {
              proposalArgs = args;
              return { ok: true, saved: false, count: rowsOf(args).length };
            }
            return { ok: false, error: "Only propose_transactions is available for a statement." };
          },
        });
        const reviewed = proposalArgs
          ? await withSpan("review-rows", "span", proposalArgs, (span) => {
              const result = reviewProposedRows(rowsOf(proposalArgs), household);
              span.update({ output: result });
              return result;
            })
          : [];
        root.update({ output: { proposedRows: reviewed.length } });
        return reviewed;
      },
    );
    if (!rows.length) {
      return jsonResult(
        { ok: false, code: "rejected", error: "No transactions were read from that statement." },
        422,
      );
    }
    const proposal: Proposal = {
      sourceName: filename,
      currency: household.currency,
      categories: household.categories,
      banks: household.banks,
      rows,
    };
    return jsonResult({ ok: true, proposal }, 200);
  } catch (error) {
    const message =
      error instanceof OpenAiError ? error.message : "Could not read that statement.";
    return jsonResult({ ok: false, code: "rejected", error: message }, 422);
  }
}
