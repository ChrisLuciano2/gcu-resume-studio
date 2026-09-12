import { NextResponse } from "next/server";
import { UnauthorizedError } from "./auth";
import { NotProvisionedError } from "./studentContext";

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (err instanceof NotProvisionedError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  // Deliberately never forward err.message here. This is the single chokepoint
  // every unexpected exception in every route passes through — including ones
  // raised from studentRest/cloudflare.ts/supabaseManagement.ts calls, whose
  // Error objects can carry a third-party API's raw response body. That body
  // might echo back something we sent (a service-role key, an OAuth client
  // secret, a fresh DB password — see the provisioning helpers). Log the full
  // error server-side for debugging; return only a fixed, safe string to the
  // client. Do not special-case this per error type "for now" — the whole point
  // is that a future error type doesn't need to be vetted before it's safe here.
  console.error(err);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
