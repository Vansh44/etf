"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkRun, startRun, type RunState } from "@/app/actions";
import { RefreshIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

const POLL_MS = 3000;
const TIMEOUT_MS = 150_000; // the Action takes ~25s; well past that means something broke

/**
 * The strip at the top of the Advisor: how fresh the prices are, and a
 * Refresh button.
 *
 * Refresh dispatches the price-fetch GitHub Action, then polls until newer
 * prices land in Supabase and refreshes the page. If no GitHub token is
 * configured it simply re-scores the stored prices and says so, rather than
 * pretending to refresh.
 */
export function RunBar({
  hasPrices,
  status,
  stale,
  canFetch,
}: {
  hasPrices: boolean;
  /** e.g. "Prices updated today, 2:30 pm" */
  status: string;
  stale: boolean;
  canFetch: boolean;
}) {
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

    let started: RunState;
    try {
      started = await startRun();
    } catch {
      setState({ phase: "error", error: "Couldn't reach the server. Check your connection and try again." });
      return;
    }
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-accent" : stale ? "bg-loss" : "bg-gain"}`}
            aria-hidden="true"
          />
          <span className="truncate">
            {busy ? `Fetching live prices… ${elapsed}s` : status}
            {!busy && stale && <span className="sr-only"> (out of date)</span>}
          </span>
        </p>
        <button
          onClick={run}
          disabled={busy}
          className={`${buttonClass("secondary", "sm")} shrink-0 rounded-full`}
        >
          <RefreshIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Running" : hasPrices ? "Refresh" : "Fetch prices"}
        </button>
      </div>

      {state.phase === "ready" && state.note && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
          {state.note}
          {!canFetch && (
            <> Set GITHUB_TOKEN and GITHUB_REPO in Vercel and Refresh will fetch new prices too.</>
          )}
        </p>
      )}

      {state.phase === "error" && (
        <p role="alert" className="rounded-xl bg-loss-soft px-3 py-2 text-xs font-medium leading-relaxed text-loss">
          {state.error}
        </p>
      )}
    </div>
  );
}
