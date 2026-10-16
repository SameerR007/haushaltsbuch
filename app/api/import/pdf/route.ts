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
import {
  combinedPageText,
  proposeFromPages,
  readLocalStatement,
  readStatementPages,
  type LocalStatementResult,
  type PageKind,
  type PageOutcome,
  type ScanProgress,
} from "@/lib/llm/local-statement";
import { guardSameOrigin, jsonResult } from "@/lib/setup/http";
import { traceSessionId, withSpan, withTrace } from "@/lib/tracing/langfuse";

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
    const step = form.get("step");
    const instruction = form.get("instruction");
    const household = loadHousehold();
    const prior = parseMessages(typeof form.get("messages") === "string" ? String(form.get("messages")) : null);
    const instructionOk = typeof instruction === "string" && instruction.trim() && instruction.length <= 8000;

    // A local import is traced like the cloud one: pdf-read (Import), pdf-propose (the user's note), or pdf-import (both).
    const localTrace = (name: string, input: unknown) => ({
      name,
      sessionId: traceSessionId(form.get("sessionId")),
      tags: ["pdf", "local"],
      input,
      metadata: {
        assistant: "local",
        model: assistant.type === "local" ? assistant.model : undefined,
        ocrModel: assistant.type === "local" ? assistant.ocrModel?.trim() || null : undefined,
      },
    });

    if (assistant.type === "local" && step === "propose") {
      if (!instructionOk) return invalid("Say what to add from this statement.");
      const pages = parsePages(form.get("pages"));
      if (!pages) return invalid("Import the statement again.");
      const filename = safePdfName(typeof form.get("filename") === "string" ? String(form.get("filename")) : "statement.pdf");
      const note = String(instruction).trim();
      return streamLocal(request, () =>
        withTrace(localTrace("pdf-propose", { instruction: note, filename, pages: pages.length }), async (root) => {
          const result = await proposeFromPages({
            pages,
            baseUrl: assistant.baseUrl,
            model: assistant.model,
            ocrModel: assistant.ocrModel?.trim() || null,
            instruction: note,
            messages: prior,
            household,
            signal: request.signal,
          });
          root.update({ output: { proposedRows: result.rows.length } });
          return proposalEvent(result, filename, household);
        }),
      );
    }

    if (!instructionOk && !(assistant.type === "local" && step === "read")) {
      return invalid("Add an instruction for this statement.");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return invalid(PDF_NOT_PDF);
    if (file.size > MAX_PDF_BYTES) return invalid(PDF_TOO_LARGE);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(bytes)) return invalid(PDF_NOT_PDF);
    const filename = safePdfName(file instanceof File ? file.name : "statement.pdf");

    if (assistant.type === "local") {
      const reading = {
        bytes,
        baseUrl: assistant.baseUrl,
        model: assistant.model,
        ocrModel: assistant.ocrModel?.trim() || null,
        signal: request.signal,
      };
      if (step === "read") {
        return streamLocal(request, (send) =>
          withTrace(localTrace("pdf-read", { filename, bytes: bytes.length }), async (root) => {
            const pages = await readStatementPages({ ...reading, onProgress: progressSender(send, filename) });
            root.update({ output: pages.map((page) => ({ page: page.page, kind: page.kind, chars: page.text.length })) });
            if (!combinedPageText(pages).trim()) {
              const failed = pages.find((page) => page.kind === "failed");
              return {
                type: "result",
                ok: false,
                code: "rejected",
                error: failed
                  ? `Couldn't read page ${failed.page}. Nothing was saved.`
                  : "No text could be read from that statement.",
              };
            }
            return { type: "result", ok: true, read: { pages } };
          }),
        );
      }
      const note = String(instruction).trim();
      return streamLocal(request, (send) =>
        withTrace(localTrace("pdf-import", { instruction: note, filename, bytes: bytes.length }), async (root) => {
          const result = await readLocalStatement({
            ...reading,
            filename,
            instruction: note,
            messages: prior,
            household,
            onProgress: progressSender(send, filename),
          });
          root.update({ output: { proposedRows: result.rows.length } });
          return proposalEvent(result, filename, household);
        }),
      );
    }

    const apiKey = assistant.apiKey;
    const messages: ChatTurn[] = recentModelTurns([...prior, { role: "user", content: String(instruction).trim() }]);
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

type Send = (event: unknown) => void;

function progressSender(send: Send, filename: string) {
  return (progress: ScanProgress) => {
    send({
      type: "progress",
      phase: "scan",
      filename,
      page: progress.page,
      total: progress.total,
      model: progress.model,
      textPages: progress.textPages,
      scannedPages: progress.scannedPages,
    });
  };
}

function proposalEvent(result: LocalStatementResult, filename: string, household: ReturnType<typeof loadHousehold>) {
  if (!result.rows.length) {
    const error = result.statement.failedPage
      ? `Couldn't read page ${result.statement.failedPage}. Nothing was saved.`
      : "No transactions matched that. Try saying it another way.";
    return { type: "result", ok: false, code: "rejected", error };
  }
  const proposal: Proposal = {
    sourceName: filename,
    currency: household.currency,
    categories: household.categories,
    banks: household.banks,
    rows: result.rows,
    statement: result.statement satisfies StatementReview,
  };
  return { type: "result", ok: true, proposal };
}

const PAGE_KINDS = new Set<PageKind>(["text", "scanned", "ocr", "fallback", "skipped", "failed", "unread"]);

/** Pages sent back by the browser after the read step. Text stays on this computer. */
function parsePages(value: FormDataEntryValue | null): PageOutcome[] | null {
  if (typeof value !== "string" || value.length > 2_000_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) return null;
  const pages: PageOutcome[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as { page?: unknown; kind?: unknown; text?: unknown };
    if (typeof record.page !== "number" || !Number.isInteger(record.page) || record.page < 1) return null;
    if (typeof record.kind !== "string" || !PAGE_KINDS.has(record.kind as PageKind)) return null;
    if (typeof record.text !== "string") return null;
    pages.push({ page: record.page, kind: record.kind as PageKind, text: record.text });
  }
  return pages;
}

function streamLocal(request: Request, work: (send: Send) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser already went away.
        }
      };
      try {
        send(await work(send));
      } catch (error) {
        if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          send({ type: "result", ok: false, cancelled: true, error: "Cancelled. Nothing was saved." });
          return;
        }
        const message = error instanceof OpenAiError ? error.message : "Could not read that statement.";
        send({ type: "result", ok: false, code: "rejected", error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
