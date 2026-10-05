import { createTables, serviceRoleFields } from "@/lib/setup/create-tables";
import { jsonResult, readJsonBody, statusFor } from "@/lib/setup/http";

// The service role key is used for this request only. Do not log or store it.

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonResult(parsed, statusFor(parsed));
  try {
    const result = await createTables(serviceRoleFields(parsed.body));
    return jsonResult(result, statusFor(result));
  } catch {
    return jsonResult(
      {
        ok: false,
        code: "ddl_unavailable",
        error:
          "Could not create tables. Run the setup SQL in the Supabase SQL editor, then check tables.",
      },
      422,
    );
  }
}
