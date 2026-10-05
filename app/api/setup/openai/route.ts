import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";
import { openAiFields, validateOpenAiKey } from "@/lib/setup/validate-openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Checks the key with OpenAI and does not store it. Do not log the request body.

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));
  try {
    const result = await validateOpenAiKey(openAiFields(parsed.body));
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not check that OpenAI key." },
      422,
    );
  }
}
