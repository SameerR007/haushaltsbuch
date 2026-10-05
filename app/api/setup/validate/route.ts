import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";
import { anonFields } from "@/lib/setup/validate-supabase";
import { validateSupabaseAnon } from "@/lib/setup/validate-supabase";

// Do not log the request body or keys.

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));
  try {
    const result = await validateSupabaseAnon(anonFields(parsed.body));
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not check that Supabase project." },
      422,
    );
  }
}
