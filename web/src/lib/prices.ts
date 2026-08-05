import { createClient } from "@/lib/supabase/server";
import type { PriceData } from "./strategy";

/**
 * Prices come from the `prices` table, written by the scheduled GitHub Action
 * (see .github/workflows/fetch-prices.yml).
 *
 * The app deliberately does NOT call Yahoo. Yahoo refuses any request whose TLS
 * fingerprint isn't a real browser's — verified: identical URL and User-Agent
 * returns HTTP 429 to a plain client and HTTP 200 to a Chrome-impersonating one.
 * Node on Vercel cannot impersonate, so the fetch happens in Actions instead.
 */

/** Older than this and the dashboard says so rather than quietly showing stale numbers. */
export const STALE_AFTER_MINUTES = 90;

export type PriceLoad = {
  data: Map<string, PriceData>;
  /** Symbols asked for that have no row in the table at all. */
  missing: string[];
  /** Newest fetched_at across the rows, or null when the table is empty. */
  fetchedAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
};

type PriceRow = {
  symbol: string;
  live_price: number | string;
  closes: number[];
  last_bar: string | null;
  fetched_at: string;
};

export async function getPrices(symbols: string[]): Promise<PriceLoad> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("prices")
    .select("symbol, live_price, closes, last_bar, fetched_at")
    .in("symbol", symbols);

  const data = new Map<string, PriceData>();
  let newest: number | null = null;

  for (const row of (rows ?? []) as PriceRow[]) {
    const livePrice = Number(row.live_price);
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    if (!Array.isArray(row.closes) || row.closes.length === 0) continue;

    data.set(row.symbol, {
      symbol: row.symbol,
      closes: row.closes.map(Number).filter((n) => Number.isFinite(n)),
      livePrice,
      lastBar: row.last_bar,
      fetchedAt: row.fetched_at,
    });

    const stamp = Date.parse(row.fetched_at);
    if (Number.isFinite(stamp) && (newest === null || stamp > newest)) newest = stamp;
  }

  const missing = symbols.filter((s) => !data.has(s));
  const ageMinutes = newest === null ? null : Math.round((Date.now() - newest) / 60_000);

  return {
    data,
    missing,
    fetchedAt: newest === null ? null : new Date(newest).toISOString(),
    ageMinutes,
    isStale: ageMinutes !== null && ageMinutes > STALE_AFTER_MINUTES,
  };
}
