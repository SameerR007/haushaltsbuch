import { initDatabase } from "@/lib/db";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Creates the local database file. Do not log the resolved path.

export async function POST() {
  try {
    return jsonResult(initDatabase(), 200);
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not create the local database." },
      422,
    );
  }
}
