import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuth landing point. Exchanges the ?code for a session, then checks
 * the email against the allowlist before letting anyone in.
 *
 * A signed-in user who is NOT on the allowlist is signed straight back out —
 * otherwise they'd hold a valid session that RLS silently starves, which looks
 * like a broken app rather than a refused login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Missing%20authorization%20code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  const { data, error: rpcError } = await supabase.rpc("is_allowed");
  if (rpcError || data !== true) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const attempted = user?.email ?? "";
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/not-allowed?email=${encodeURIComponent(attempted)}`,
    );
  }

  // Only allow relative redirects — an attacker-supplied ?next must not be
  // able to bounce a freshly-authenticated user to another origin.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(`${origin}${target}`);
}
