import { addBank } from "@/lib/data/banks";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));
  try {
    const result = addBank(parsed.body.name, parsed.body.initials);
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not add that bank." }, 422);
  }
}
