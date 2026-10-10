import { restoreBank } from "@/lib/data/banks";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const result = restoreBank(parsed.body.name);
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not add that bank back." }, 422);
  }
}
