import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Always uses the ANON key, never a service-role key — every query runs as the
 * logged-in user so the RLS allowlist in the database applies. A service-role
 * key would bypass RLS entirely and make the allowlist decorative.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies. Harmless — middleware
            // refreshes the session on every request.
          }
        },
      },
    },
  );
}

/** The signed-in user's email, or null. */
export async function getSessionEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/**
 * Is the signed-in user on the allowlist?
 *
 * Asks the database via is_allowed() rather than comparing in JS, so the UI and
 * the RLS policies can never disagree about who is allowed.
 */
export async function isAllowed(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_allowed");
  if (error) return false;
  return data === true;
}
