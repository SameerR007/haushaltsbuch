import type { SetupError } from "./types";

export function jsonResult(
  body: { ok: boolean; [key: string]: unknown },
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function statusFor(result: { ok: true } | SetupError): number {
  if (result.ok) return 200;
  if (result.code === "invalid") return 400;
  return 422;
}

export type JsonBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Reject a browser that says the call came from another site.
 * Missing `Sec-Fetch-Site` and `Origin` are allowed. This does not check Content-Type.
 */
export function guardSameOrigin(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site.trim().toLowerCase() !== "same-origin") {
    return jsonResult(
      { ok: false, code: "rejected", error: "This request must come from this app." },
      403,
    );
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
    const host = (request.headers.get("host") ?? "").trim();
    if (!originHost || originHost.toLowerCase() !== host.toLowerCase()) {
      return jsonResult(
        { ok: false, code: "rejected", error: "This request must come from this app." },
        403,
      );
    }
  }
  return null;
}

/**
 * Shared check for every route that writes the database.
 * A cross-site form can POST `text/plain` without a preflight, and `request.json()`
 * would still parse it. Reject that, and reject a browser that says the call
 * came from another site.
 */
export function guardStateChange(request: Request): Response | null {
  const media = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (media !== "application/json") {
    return jsonResult(
      { ok: false, code: "invalid", error: "Send JSON (Content-Type: application/json)." },
      415,
    );
  }
  return guardSameOrigin(request);
}

export async function readJsonBody(request: Request): Promise<JsonBody> {
  const blocked = guardStateChange(request);
  if (blocked) return { ok: false, response: blocked };
  const length = request.headers.get("content-length");
  if (length && Number(length) > 32_000) {
    return {
      ok: false,
      response: jsonResult({ ok: false, code: "invalid", error: "Invalid request." }, 400),
    };
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {
        ok: false,
        response: jsonResult({ ok: false, code: "invalid", error: "Invalid request." }, 400),
      };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: jsonResult({ ok: false, code: "invalid", error: "Invalid request." }, 400),
    };
  }
}
