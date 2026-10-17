/**
 * An OpenAI-compatible endpoint always gets reasoning_effort "none": the app needs quick
 * tool calls, and some hosted models (OpenAI's newer ones on /v1/chat/completions) refuse
 * tools while reasoning is on. Models without a reasoning setting may reject the field
 * instead, answering 400 with a message about reasoning. Then the same request goes once
 * more without it. Every other request and response passes through untouched.
 */
export function withReasoningOff(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const body = jsonBody(init);
    if (!body || "reasoning_effort" in body) return fetchImpl(input, init);
    const response = await fetchImpl(input, { ...init, body: JSON.stringify({ ...body, reasoning_effort: "none" }) });
    if (response.status !== 400) return response;
    const text = await response.clone().text();
    if (!/reasoning/i.test(text)) return response;
    return fetchImpl(input, init);
  };
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
