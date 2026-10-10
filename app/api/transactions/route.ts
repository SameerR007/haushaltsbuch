import { listTransactions } from "@/lib/data/ledger";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return jsonResult(listTransactions(), 200);
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not load expenses." }, 422);
  }
}
