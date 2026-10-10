import { backupDatabaseFile, SQLITE_FILENAME } from "@/lib/data/export-file";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bytes = await backupDatabaseFile();
    if (!bytes) {
      return jsonResult(
        { ok: false, code: "invalid", error: "There is no database to download yet." },
        400,
      );
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${SQLITE_FILENAME}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not copy the database." }, 422);
  }
}
