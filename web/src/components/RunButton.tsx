"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkRun, startRun, type RunState } from "@/app/actions";

const POLL_MS = 3000;
const TIMEOUT_MS = 150_000; // the Action takes ~25s; well past that means something broke

/**
 * Runs the advisor on demand.
 *
 * Pressing it dispatches the price-fetch GitHub Action, then polls until newer
 * prices land in Supabase and refreshes the page. If no GitHub token is
 * configured it simply re-scores the stored prices and says so, rather than
 * pretending to refresh.
 */
export function RunButton({ hasPrices }: { hasPrices: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});

  const stop = useCallback(() => {
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.tick) clearInterval(timers.current.tick);
    timers.current = {};
  }, []);

  useEffect(() => stop, [stop]);

  async function run() {
    stop();
    setElapsed(0);
    setState({ phase: "fetching", since: null });

    const started = await startRun();
    setState(started);

    if (started.phase !== "fetching") {
      if (started.phase === "ready") router.refresh();
      return;
    }

    const begun = Date.now();
    timers.current.tick = setInterval(() => setElapsed(Math.round((Date.now() - begun) / 1000)), 1000);

    timers.current.poll = setInterval(async () => {
      if (Date.now() - begun > TIMEOUT_MS) {
        stop();
        setState({
          phase: "error",
          error:
            "The price fetch didn't finish in time. Check the Fetch ETF prices run in GitHub Actions — " +
            "the numbers below are the last ones stored.",
        });
        return;
      }
      try {
        const { fresh } = await checkRun(started.since);
        if (fresh) {
          stop();
          setState({ phase: "ready" });
          router.refresh();
        }
      } catch {
        // A single failed poll is not fatal; the timeout above is the backstop.
      }
    }, POLL_MS);
  }

  const busy = state.phase === "fetching";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition disabled:opacity-70 sm:w-auto"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {busy ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true"
              />
              Fetching live prices… {elapsed}s
            </>
          ) : (
            <>{hasPrices ? "Find cheapest ETF" : "Fetch prices & find cheapest ETF"}</>
          )}
        </button>

        {busy && (
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            Running the fetcher on GitHub — usually ~30s.
          </p>
        )}
      </div>

      {state.phase === "ready" && state.note && (
        <p
          className="rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
        >
          {state.note}
        </p>
      )}

      {state.phase === "error" && (
        <p
          className="rounded-xl px-3 py-2 text-xs font-medium"
          style={{ background: "var(--loss-soft)", color: "var(--loss)" }}
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
