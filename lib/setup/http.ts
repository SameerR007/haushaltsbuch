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

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | SetupError> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > 32_000) {
    return { ok: false, code: "invalid", error: "Invalid request." };
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { ok: false, code: "invalid", error: "Invalid request." };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, code: "invalid", error: "Invalid request." };
  }
}
