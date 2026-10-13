import { probeAssistant } from "@/lib/assistant/probe";
import { parseProbeRequest } from "@/lib/assistant/target";
import { jsonResult, readJsonBody } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Checks a local app or an OpenAI-compatible endpoint. The key, when there is
// one, is sent only as a bearer token on this request. It is not stored or logged.

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseProbeRequest(body.body);
  if (!parsed.ok) return jsonResult({ ok: false, code: "invalid", error: parsed.error }, 400);
  const result = await probeAssistant(parsed.value);
  if (result.ok) {
    return jsonResult(
      {
        ok: true,
        status: result.status,
        title: result.title,
        detail: result.detail,
        seconds: result.seconds,
      },
      200,
    );
  }
  return jsonResult(
    {
      ok: false,
      code: "rejected",
      status: result.status,
      title: result.title,
      detail: result.detail,
      ...(result.command ? { command: result.command } : {}),
      error: result.title,
    },
    422,
  );
}
