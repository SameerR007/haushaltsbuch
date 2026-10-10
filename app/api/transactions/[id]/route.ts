import { updateTransaction } from "@/lib/data/ledger";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const body = parsed.body;
  const patch: {
    date?: unknown;
    category?: unknown;
    bank?: unknown;
    amount?: unknown;
    notes?: unknown;
  } = {};
  if ("date" in body) patch.date = body.date;
  if ("category" in body) patch.category = body.category;
  if ("bank" in body) patch.bank = body.bank;
  if ("amount" in body) patch.amount = body.amount;
  if ("notes" in body) patch.notes = body.notes;
  try {
    const result = updateTransaction(id, patch);
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not save that change." }, 422);
  }
}
