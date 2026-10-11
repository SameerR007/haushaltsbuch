import { loadCompareSummary, loadPeriodSummary } from "@/lib/data/summary";
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
  const scope = params.get("scope");
  if (scope !== null && scope !== "period" && scope !== "compare") {
    return jsonResult({ ok: false, code: "invalid", error: "Choose One period or Compare two periods." }, 400);
  }
  const from = readDate(params, "from");
  const to = readDate(params, "to");
  if (from === "bad" || to === "bad") {
    return jsonResult({ ok: false, code: "invalid", error: "Enter a real date (YYYY-MM-DD)." }, 400);
  }
  if ((from === null) !== (to === null)) {
    return jsonResult({ ok: false, code: "invalid", error: "Enter both the start date and the end date." }, 400);
  }
  if (from && to && from > to) {
    return jsonResult({ ok: false, code: "invalid", error: "Choose a start date on or before the end date." }, 400);
  }

  try {
    if (scope === "compare") {
      const compareFrom = readDate(params, "compareFrom");
      const compareTo = readDate(params, "compareTo");
      if (compareFrom === "bad" || compareTo === "bad") {
        return jsonResult({ ok: false, code: "invalid", error: "Enter a real date (YYYY-MM-DD)." }, 400);
      }
      if (!from || !to || !compareFrom || !compareTo) {
        return jsonResult({ ok: false, code: "invalid", error: "Enter both the start date and the end date." }, 400);
      }
      if (compareFrom > compareTo) {
        return jsonResult(
          { ok: false, code: "invalid", error: "Choose a start date on or before the end date." },
          400,
        );
      }
      const result = loadCompareSummary({ from, to, compareFrom, compareTo });
      if (!result.ok) return jsonResult(result, 400);
      return jsonResult(result, 200);
    }
    const result = loadPeriodSummary({ from, to });
    if (!result.ok) return jsonResult(result, 400);
    return jsonResult(result, 200);
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not load the summary." }, 422);
  }
}
