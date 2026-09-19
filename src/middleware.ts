import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Gate the browser pages only.
 *
 * API routes are deliberately not matched here: they accept a bearer token as
 * well as a session, and that decision belongs in `guard()` where both doors
 * are visible together. Middleware that also checked the key would duplicate
 * the rule and eventually disagree with it.
 */
export async function middleware(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Failing open here would publish the whole app. Failing closed with a
    // readable message is the better wrong state.
    return new NextResponse(
      "SESSION_SECRET is not set. Add it to the environment and redeploy.",
      { status: 500 },
    );
  }

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") {
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico).*)"],
};
