"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for browser components (used only to start Google OAuth). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
