import { NOTHING_SAVED_TYPE } from "@/lib/assistant/copy";
import { parseAssistantTarget } from "@/lib/assistant/target";
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
import type { ChatTurn, Proposal, StatementReview } from "@/lib/chat/types";
import { reviewProposedRows, rowsOf } from "@/lib/chat/validate-rows";
import { readLocalStatement, type ScanProgress } from "@/lib/llm/local-statement";
import { guardSameOrigin, jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenAI and an OpenAI-compatible endpoint receive the PDF as a file part.
// A local assistant reads the text layer and scanned pages on this machine.
// Nothing is written here. Confirm is the only save.

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

    if (assistant.type === "local") {
      return streamLocalImport({
        request,
        bytes,
        filename,
        instruction: instruction.trim(),
        prior,
        household,
        assistant,
      });
    }

    const apiKey = assistant.apiKey;
    const messages: ChatTurn[] = recentModelTurns([...prior, { role: "user", content: instruction.trim() }]);
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

    const rows = proposalArgs ? reviewProposedRows(rowsOf(proposalArgs), household) : [];
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
    if (error instanceof OpenAiError && error.fileRejected) {
      return jsonResult(
        {
          ok: false,
          code: "rejected",
          error: error.message,
          changeAssistant: true,
          detail: NOTHING_SAVED_TYPE,
        },
        422,
      );
    }
    const message = error instanceof OpenAiError ? error.message : "Could not read that statement.";
    return jsonResult({ ok: false, code: "rejected", error: message }, 422);
  }
}

function streamLocalImport(options: {
  request: Request;
  bytes: Uint8Array;
  filename: string;
  instruction: string;
  prior: ChatTurn[];
  household: ReturnType<typeof loadHousehold>;
  assistant: { type: "local"; baseUrl: string; model: string; ocrModel?: string | null };
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await readLocalStatement({
          bytes: options.bytes,
          filename: options.filename,
          baseUrl: options.assistant.baseUrl,
          model: options.assistant.model,
          ocrModel: options.assistant.ocrModel?.trim() || null,
          instruction: options.instruction,
          messages: options.prior,
          household: options.household,
          signal: options.request.signal,
          onProgress: (progress: ScanProgress) => {
            send({
              type: "progress",
              phase: "scan",
              filename: options.filename,
              page: progress.page,
              total: progress.total,
              model: progress.model,
              textPages: progress.textPages,
              scannedPages: progress.scannedPages,
            });
          },
        });
        if (!result.rows.length) {
          const error = result.statement.failedPage
            ? `Couldn't read page ${result.statement.failedPage}. Nothing was saved.`
            : "No transactions were read from that statement.";
          send({ type: "result", ok: false, code: "rejected", error });
          return;
        }
        const proposal: Proposal = {
          sourceName: options.filename,
          currency: options.household.currency,
          categories: options.household.categories,
          banks: options.household.banks,
          rows: result.rows,
          statement: result.statement satisfies StatementReview,
        };
        send({ type: "result", ok: true, proposal });
      } catch (error) {
        if (options.request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          send({ type: "result", ok: false, cancelled: true, error: "Cancelled. Nothing was saved." });
          return;
        }
        const message = error instanceof OpenAiError ? error.message : "Could not read that statement.";
        send({ type: "result", ok: false, code: "rejected", error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
