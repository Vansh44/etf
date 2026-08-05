"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const next = params.get("next") ?? "/";

  async function signIn() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser navigates to Google; nothing more to do here.
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div
        className="w-full max-w-sm rounded-2xl border p-6 sm:p-8"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            aria-hidden="true"
          >
            ₹
          </span>
          <h1 className="text-lg font-semibold">ETF Advisor</h1>
        </div>

        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
          Sign in with Google. Only allow-listed email addresses can get in.
        </p>

        {error && (
          <p
            className="mt-4 rounded-xl px-3 py-2.5 text-sm font-medium"
            style={{ background: "var(--loss-soft)", color: "var(--loss)" }}
          >
            {error}
          </p>
        )}

        <button
          onClick={signIn}
          disabled={busy}
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border text-sm font-medium transition disabled:opacity-60"
          style={{ borderColor: "var(--hairline)" }}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
            />
          </svg>
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </main>
  );
}
