import { readHousehold } from "@/lib/data/banks";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return jsonResult(readHousehold(), 200);
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not read the database on this computer." },
      422,
    );
  }
}
