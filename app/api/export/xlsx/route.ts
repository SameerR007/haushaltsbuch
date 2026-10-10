import { buildExpensesWorkbook, XLSX_FILENAME } from "@/lib/data/export-file";
import { jsonResult } from "@/lib/setup/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const buffer = await buildExpensesWorkbook();
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${XLSX_FILENAME}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return jsonResult({ ok: false, code: "rejected", error: "Could not build the Excel file." }, 422);
  }
}
