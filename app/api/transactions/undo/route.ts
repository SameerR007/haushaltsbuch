import { undoTransactions } from "@/lib/chat/transactions";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 100_000) {
      return jsonResult({ ok: false, code: "invalid", error: "That request is too large." }, 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResult({ ok: false, code: "invalid", error: "Invalid request." }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return jsonResult({ ok: false, code: "invalid", error: "Nothing to undo." }, 400);
    }
    const record = body as { ids?: unknown; batchId?: unknown };
    const result = undoTransactions(record.ids, record.batchId);
    if (!result.ok) {
      return jsonResult(result, result.code === "invalid" ? 400 : 422);
    }
    return jsonResult(result, 200);
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not undo those transactions." },
      422,
    );
  }
}
