"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/icons";

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
    <main
      className="flex min-h-dvh flex-col justify-between px-6 sm:items-center sm:justify-center"
      style={{
        paddingTop: "max(3rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full sm:max-w-sm sm:rounded-3xl sm:border sm:border-hairline sm:bg-surface sm:p-10 sm:shadow-card">
        <BrandMark size={52} />
        <h1 className="mt-7 text-[28px] font-semibold leading-tight tracking-tight">ETF Advisor</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Which ETF to buy next and how many units — scored on how cheap it is and how far your portfolio is
          from its targets.
        </p>

        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-loss-soft px-3.5 py-3 text-sm font-medium text-loss">
            {error}
          </p>
        )}

        {/* Wider screens keep the button inside the card. */}
        <div className="hidden sm:block">
          <GoogleButton busy={busy} onClick={signIn} />
        </div>
      </div>

      {/* Phones put it in the thumb zone, at the bottom of the screen. */}
      <div className="w-full sm:hidden">
        <GoogleButton busy={busy} onClick={signIn} />
      </div>
    </main>
  );
}

function GoogleButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className="mt-8 flex min-h-13 w-full items-center justify-center gap-3 rounded-2xl border border-hairline-strong bg-surface text-[15px] font-semibold shadow-card transition hover:bg-surface-2 active:scale-[0.98] disabled:opacity-60"
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
      <p className="mt-3 text-center text-xs text-ink-2">Only allow-listed accounts can get in.</p>
    </>
  );
}
