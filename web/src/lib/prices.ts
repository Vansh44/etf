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
  // Added by the iNAV migration. Absent, not null, on a database that predates
  // it — hence the legacy select below.
  inav?: number | string | null;
  inav_at?: string | null;
  premium_history?: unknown;
};

const COLUMNS =
  "symbol, live_price, closes, last_bar, nav, nav_date, inav, inav_at, premium_history, fetched_at";
const LEGACY_COLUMNS = "symbol, live_price, closes, last_bar, nav, nav_date, fetched_at";

export async function getPrices(symbols: string[]): Promise<PriceLoad> {
  if (symbols.length === 0) return { data: new Map(), missing: [] };

  const supabase = await createClient();
  const current = await supabase.from("prices").select(COLUMNS).in("symbol", symbols);

  // Selecting a column that does not exist fails the whole request, and an
  // unpriced watchlist blocks every recommendation. Falling back to the
  // pre-migration columns keeps the advisor working — with the weaker EOD-NAV
  // premium check — until schema.sql is applied.
  const legacy = current.error
    ? await supabase.from("prices").select(LEGACY_COLUMNS).in("symbol", symbols)
    : null;

  const rows = ((current.error ? legacy?.data : current.data) ?? []) as PriceRow[];

  const data = new Map<string, PriceData>();

  for (const row of rows) {
    const livePrice = Number(row.live_price);
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    if (!Array.isArray(row.closes) || row.closes.length === 0) continue;

    const positive = (v: number | string | null | undefined) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    data.set(row.symbol, {
      symbol: row.symbol,
      closes: row.closes.map(Number).filter((n) => Number.isFinite(n)),
      livePrice,
      lastBar: row.last_bar,
      nav: positive(row.nav),
      navDate: row.nav_date,

      // Both are optional inputs. The fetcher only publishes an iNAV for runs
      // inside market hours, and premium_history takes ~60 sessions to become
      // usable (or one `--backfill` run); until then the premium check falls
      // back to the EOD NAV and the percentile gate stays quiet.
      inav: positive(row.inav),
      inavAt: row.inav_at ?? null,
      premiumHistory: Array.isArray(row.premium_history)
        ? (row.premium_history as unknown[]).map(Number).filter((n) => Number.isFinite(n))
        : [],

      fetchedAt: row.fetched_at,
    });
  }

  return { data, missing: symbols.filter((s) => !data.has(s)) };
}
