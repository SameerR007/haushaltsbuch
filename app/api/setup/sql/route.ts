import { loadSetupSql } from "@/lib/setup/schema";

export const dynamic = "force-dynamic";

/** Public setup script. It contains no keys. */
export function GET() {
  return new Response(loadSetupSql(), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
