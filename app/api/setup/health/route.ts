import { readHealth } from "@/lib/db";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return jsonResult(readHealth(), 200);
  } catch {
    return jsonResult(
      { ok: true, dbReady: false, currency: null, banksCount: 0 },
      200,
    );
  }
}
