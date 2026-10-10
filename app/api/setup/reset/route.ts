import { resetHousehold } from "@/lib/db";
import { jsonResult, readJsonBody } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (parsed.body.confirm !== true) {
    return jsonResult(
      { ok: false, code: "invalid", error: "Confirm that you want to delete everything." },
      400,
    );
  }
  try {
    resetHousehold();
    return jsonResult({ ok: true }, 200);
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not delete the saved data." }, 422);
  }
}
