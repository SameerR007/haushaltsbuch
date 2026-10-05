import { looksLikeOpenAiKey, readString } from "./guards";
import type { SetupResult } from "./types";

type FetchLike = typeof fetch;

/**
 * Checks an OpenAI key with OpenAI, then drops it.
 * Callers store a valid key in the browser only.
 */
export async function validateOpenAiKey(
  input: { apiKey?: string },
  fetchImpl: FetchLike = fetch,
): Promise<SetupResult> {
  const apiKey = (input.apiKey ?? "").trim();
  if (!looksLikeOpenAiKey(apiKey)) {
    return {
      ok: false,
      code: "invalid",
      error: "Paste an OpenAI API key (it starts with sk-).",
    };
  }

  let res: Response;
  try {
    res = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return {
      ok: false,
      code: "rejected",
      error: "Could not reach OpenAI to check that key.",
    };
  }

  await res.body?.cancel().catch(() => undefined);
  if (res.status === 200) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "rejected", error: "OpenAI rejected that key." };
  }
  if (res.status === 429) {
    return {
      ok: false,
      code: "rejected",
      error: "OpenAI rate-limited the check. Try again in a moment.",
    };
  }
  return {
    ok: false,
    code: "rejected",
    error: "Could not check that OpenAI key.",
  };
}

export function openAiFields(body: Record<string, unknown>): { apiKey: string } {
  return { apiKey: readString(body, "apiKey") };
}
