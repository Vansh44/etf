import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and bounces
 * signed-out visitors to /login.
 *
 * This is a convenience gate, not the security boundary — the real enforcement
 * is the RLS allowlist in Postgres. Even a forged cookie yields zero rows.
 */

const PUBLIC_PATHS = ["/login", "/auth", "/not-allowed"];

export async function proxy(request: NextRequest) {
  // The sample-data design preview (src/app/preview) talks to no database and
  // exists only under `next dev`; in a production build the route 404s.
  if (process.env.NODE_ENV === "development" && request.nextUrl.pathname.startsWith("/preview")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() is what actually refreshes an expiring token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip static assets, images and the home-screen icon + manifest — they need
  // no session, and iOS fetches the icon without the session cookie.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
