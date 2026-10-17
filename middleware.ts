import { NextResponse, type NextRequest } from "next/server";
import { extraHostNames, hostAllowed } from "@/lib/local-host";

/** Every page and API route: refuse a request that wasn't addressed to this computer. See lib/local-host.ts. */
export function middleware(request: NextRequest) {
  if (hostAllowed(request.headers.get("host"), extraHostNames(process.env.HAUSHALTSBUCH_ALLOWED_HOSTS))) {
    return NextResponse.next();
  }
  return new NextResponse("Haushaltsbuch only answers on this computer. Open it there at http://localhost and the port it printed.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
