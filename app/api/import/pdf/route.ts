import { loadHousehold } from "@/lib/chat/household";
import { OpenAiError, runChatTurn } from "@/lib/chat/openai";
import {
  isPdfBytes,
  MAX_PDF_BYTES,
  PDF_NOT_PDF,
  PDF_TOO_LARGE,
  safePdfName,
} from "@/lib/chat/pdf-meta";
import { householdInstructions, todayIso, withPdfInstructions } from "@/lib/chat/prompts";
import type { ChatTurn, Proposal } from "@/lib/chat/types";
import { reviewProposedRows, rowsOf } from "@/lib/chat/validate-rows";
import { looksLikeOpenAiKey } from "@/lib/setup/guards";
import { jsonResult } from "@/lib/setup/http";

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
  for (const item of parsed.slice(0, 40)) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.content !== "string" || record.content.length > 8000) continue;
    messages.push({ role: record.role, content: record.content });
  }
  return messages;
}

export async function POST(request: Request) {
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
    const apiKey = form.get("apiKey");
    const instruction = form.get("instruction");
    const file = form.get("file");
    if (typeof apiKey !== "string" || !looksLikeOpenAiKey(apiKey)) {
      return invalid("Add an OpenAI key in setup.");
    }
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
    const messages: ChatTurn[] = [...prior, { role: "user", content: instruction.trim() }];
    let proposalArgs: unknown = null;
    await runChatTurn({
      apiKey,
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
    const message =
      error instanceof OpenAiError ? error.message : "Could not read that statement.";
    return jsonResult({ ok: false, code: "rejected", error: message }, 422);
  }
}
