import { removeBank } from "@/lib/data/banks";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));
  try {
    const result = removeBank(parsed.body.name);
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not remove that bank." }, 422);
  }
}
