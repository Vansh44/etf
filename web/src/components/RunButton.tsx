"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { checkRun, startRun, type RunState } from "@/app/actions";
import { RefreshIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

const POLL_MS = 3000;
// Dispatched runs finish in 30–90s from button to write; well past that means something broke.
const TIMEOUT_MS = 150_000;

type Run = {
  state: RunState;
  /** When the current fetch was dispatched, for the elapsed counter. */
  startedAt: number | null;
  /** A fetch is in flight, or the page it produced is still being put on screen. */
  busy: boolean;
  run: () => void;
};

const RunContext = createContext<Run | null>(null);

/**
 * Owns the Refresh run.
 *
 * Refresh dispatches the price-fetch GitHub Action, then polls until newer
 * prices land in Supabase. The poll that finds them carries the re-rendered
 * page back in the same response (checkRun revalidates), so there is no
 * second round trip to fetch it.
 *
 * It lives in the app shell rather than in the button so a fetch survives
 * moving between tabs: whichever page is open when the prices land is the one
 * that re-renders.
 */
export function RunProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Pending from a Server Action's dispatch until the page it re-rendered is
  // committed. The action's own promise resolves before that, so going by the
  // promise alone reset the button while the old numbers were still showing.
  const [rendering, startTransition] = useTransition();
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  /**
   * Calls a Server Action inside this transition, so `rendering` stays true
   * until any page it returns is on screen. The callback is synchronous on
   * purpose: an async one would hold every navigation until the poll returns.
   */
  function inTransition<T>(action: () => Promise<T>): Promise<T> {
    let result!: Promise<T>;
    startTransition(() => {
      result = action();
    });
    return result;
  }

  async function run() {
    current.current?.abort();
    const { signal } = (current.current = new AbortController());

    setStartedAt(Date.now());
    setState({ phase: "fetching", since: null });

    let started: RunState;
    try {
      started = await inTransition(startRun);
    } catch {
      if (!signal.aborted) {
        setState({ phase: "error", error: "Couldn't reach the server. Check your connection and try again." });
      }
      return;
    }
    if (signal.aborted) return;
    setState(started);
    if (started.phase !== "fetching") return;

    const since = started.since;
    const begun = Date.now();
    while (await nextPoll(signal)) {
      // A single failed poll is not fatal; the timeout below is the backstop.
      const fresh = await inTransition(() => checkRun(since)).then(
        (result) => result.fresh,
        () => false,
      );
      if (signal.aborted) return;

      // Freshness before the timeout: a phone that slept through the fetch
      // should wake up to the new prices, not to an error about them.
      if (fresh) {
        setState({ phase: "ready" });
        return;
      }
      if (Date.now() - begun > TIMEOUT_MS) {
        setState({
          phase: "error",
          error:
            "The price fetch didn't finish in time. Check the Fetch ETF prices run in GitHub Actions — " +
            "the numbers below are the last ones stored.",
        });
        return;
      }
    }
  }

  const busy = state.phase === "fetching" || rendering;

  return <RunContext value={{ state, startedAt, busy, run }}>{children}</RunContext>;
}

/**
 * Waits out one poll interval: true when it is time to poll, false once the
 * run is abandoned. A hidden page does not poll — a phone suspends it anyway —
 * and coming back to it polls straight away rather than a full interval later.
 */
function nextPoll(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);

    const visible = () => document.visibilityState === "visible";
    const finish = (poll: boolean) => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      signal.removeEventListener("abort", onAbort);
      resolve(poll);
    };
    const onVisibility = () => visible() && finish(true);
    const onAbort = () => finish(false);
    const timer = setTimeout(() => visible() && finish(true), POLL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    signal.addEventListener("abort", onAbort);
  });
}

/** Whole seconds since `from`, ticking while it is set. */
function useElapsed(from: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (from === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [from]);
  return from === null ? 0 : Math.max(0, Math.round((now - from) / 1000));
}

type RunBarProps = {
  hasPrices: boolean;
  /** e.g. "Prices updated today, 2:30 pm" */
  status: string;
  stale: boolean;
  canFetch: boolean;
};

/**
 * The strip at the top of the Advisor: how fresh the prices are, and a
 * Refresh button. If no GitHub token is configured, Refresh simply re-scores
 * the stored prices and says so, rather than pretending to refresh.
 */
export function RunBar(props: RunBarProps) {
  // Outside the app shell — rendered without one when the layout finds no
  // session email — it still works, with a run that ends with the page.
  return useContext(RunContext) ? (
    <RunStrip {...props} />
  ) : (
    <RunProvider>
      <RunStrip {...props} />
    </RunProvider>
  );
}

function RunStrip({ hasPrices, status, stale, canFetch }: RunBarProps) {
  const { state, startedAt, busy, run } = useContext(RunContext)!;
  const elapsed = useElapsed(state.phase === "fetching" ? startedAt : null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-accent" : stale ? "bg-loss" : "bg-gain"}`}
            aria-hidden="true"
          />
          <span className="truncate">
            {busy
              ? state.phase === "fetching"
                ? `Fetching live prices… ${elapsed}s`
                : "Loading the new prices…"
              : status}
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

      {!busy && state.phase === "ready" && state.note && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
          {state.note}
          {!canFetch && (
            <> Set GITHUB_TOKEN and GITHUB_REPO in Vercel and Refresh will fetch new prices too.</>
          )}
        </p>
      )}

      {!busy && state.phase === "error" && (
        <div role="alert" className="rounded-xl bg-loss-soft px-3.5 py-3 text-xs leading-relaxed">
          <p className="font-medium text-loss">{state.error}</p>
          {state.href && (
            <a
              href={state.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonClass("secondary", "sm")} mt-2.5 w-full sm:w-auto`}
            >
              Open the workflow on GitHub
            </a>
          )}
        </div>
      )}
    </div>
  );
}
