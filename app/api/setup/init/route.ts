import { initDatabase } from "@/lib/db";
import { guardStateChange, jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Creates the local database file. Do not log the resolved path.

export async function POST(request: Request) {
  const blocked = guardStateChange(request);
  if (blocked) return blocked;
  try {
    return jsonResult(initDatabase(), 200);
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not create the local database." },
      422,
    );
  }
}
