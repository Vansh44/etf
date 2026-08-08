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
 *
 * Freshness is judged in strategy.ts, which has the settings to judge it with.
 */

export type PriceLoad = {
  data: Map<string, PriceData>;
  /** Symbols asked for that have no row in the table at all. */
  missing: string[];
};

type PriceRow = {
  symbol: string;
  live_price: number | string;
  closes: number[];
  last_bar: string | null;
  nav: number | string | null;
  nav_date: string | null;
  fetched_at: string;
};

export async function getPrices(symbols: string[]): Promise<PriceLoad> {
  if (symbols.length === 0) return { data: new Map(), missing: [] };

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("prices")
    .select("symbol, live_price, closes, last_bar, nav, nav_date, fetched_at")
    .in("symbol", symbols);

  const data = new Map<string, PriceData>();

  for (const row of (rows ?? []) as PriceRow[]) {
    const livePrice = Number(row.live_price);
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    if (!Array.isArray(row.closes) || row.closes.length === 0) continue;

    const nav = row.nav === null ? null : Number(row.nav);

    data.set(row.symbol, {
      symbol: row.symbol,
      closes: row.closes.map(Number).filter((n) => Number.isFinite(n)),
      livePrice,
      lastBar: row.last_bar,
      nav: nav !== null && Number.isFinite(nav) && nav > 0 ? nav : null,
      navDate: row.nav_date,

      // The fetcher publishes EOD NAV only — no intraday iNAV and no trailing
      // premium series yet. Both are optional inputs: with them absent the
      // premium check falls back to EOD NAV and the percentile gate stays
      // quiet, which is exactly what it did before. Wire these up in
      // scripts/fetch_prices.py to switch the stronger checks on.
      inav: null,
      inavAt: null,
      premiumHistory: [],

      fetchedAt: row.fetched_at,
    });
  }

  return { data, missing: symbols.filter((s) => !data.has(s)) };
}
