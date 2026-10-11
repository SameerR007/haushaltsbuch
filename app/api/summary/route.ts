import { loadSummary } from "@/lib/data/summary";
import { jsonResult } from "@/lib/setup/http";
import { parseIsoDate } from "@/lib/chat/validate-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readDate(params: URLSearchParams, key: string): string | null | "bad" {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  return parseIsoDate(raw) ?? "bad";
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = readDate(params, "from");
  const to = readDate(params, "to");
  const compareFrom = readDate(params, "compareFrom");
  const compareTo = readDate(params, "compareTo");
  if (from === "bad" || to === "bad" || compareFrom === "bad" || compareTo === "bad") {
    return jsonResult({ ok: false, code: "invalid", error: "Enter a real date (YYYY-MM-DD)." }, 400);
  }
  if ((from === null) !== (to === null) || (compareFrom === null) !== (compareTo === null)) {
    return jsonResult({ ok: false, code: "invalid", error: "Enter both the start date and the end date." }, 400);
  }
  if ((from && to && from > to) || (compareFrom && compareTo && compareFrom > compareTo)) {
    return jsonResult(
      { ok: false, code: "invalid", error: "Choose a start date on or before the end date." },
      400,
    );
  }
  try {
    const result = loadSummary({ from, to, compareFrom, compareTo });
    if (!result.ok) return jsonResult(result, 400);
    return jsonResult(result, 200);
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not load the summary." }, 422);
  }
}
