import { saveHousehold } from "@/lib/db";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";
import type { SetupError } from "@/lib/setup/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Writes currency and banks. The body has no API key. Do not log it.

function invalid(error: string): SetupError {
  return { ok: false, code: "invalid", error };
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));

  const currency = parsed.body.currency;
  const banks = parsed.body.banks;
  if (typeof currency !== "string") {
    return jsonResult(invalid("Choose a 3-letter currency code."), 400);
  }
  if (!Array.isArray(banks)) {
    return jsonResult(invalid("Add at least one bank."), 400);
  }

  const rows: { name: string; initials: string }[] = [];
  for (const bank of banks) {
    if (typeof bank !== "object" || bank === null) {
      return jsonResult(invalid("Enter a bank name and initials (1–4 letters)."), 400);
    }
    const record = bank as Record<string, unknown>;
    rows.push({
      name: typeof record.name === "string" ? record.name : "",
      initials: typeof record.initials === "string" ? record.initials : "",
    });
  }

  try {
    const result = saveHousehold({ currency, banks: rows });
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult(
      { ok: false, code: "rejected", error: "Could not save currency and banks." },
      422,
    );
  }
}
