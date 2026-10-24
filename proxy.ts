import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Password gate for the hosted site. When SITE_PASSWORD is set (on Vercel),
// every page and API call asks for it through the browser's own sign-in box.
// Locally, with no SITE_PASSWORD, the app stays open.
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      // Any username is accepted; only the password matters.
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(given, password)) return NextResponse.next();
    } catch {
      // Malformed header: fall through to the challenge.
    }
  }

  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="FinancialIQ", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
