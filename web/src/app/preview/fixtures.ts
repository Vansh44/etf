/**
 * Sample data for the design preview. Not real prices: deterministic random
 * walks around plausible levels, shaped so every part of the UI has something
 * to show — an eligible field, an ETF dropped for thin history, one dropped
 * for its premium, a premium-sensitive ETF with a live iNAV.
 *
 * Holdings and the watchlist mirror the shape of the real portfolio so the
 * layout is judged at a realistic density.
 */

import type { AllowedEmail, Holding, WatchlistItem } from "@/lib/data";
import {
  DEFAULT_SETTINGS,
  lastCompletedSession,
  runStrategy,
  type PriceData,
  type Settings,
} from "@/lib/strategy";
import { valuePortfolio } from "@/lib/valuation";

export type PreviewState = "default" | "nobuy" | "stale" | "warn" | "empty";

export function parseState(raw: string | string[] | undefined): PreviewState {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "nobuy" || value === "stale" || value === "warn" || value === "empty" ? value : "default";
}

const WATCHLIST: WatchlistItem[] = [
  { symbol: "ALPHA", name: "Kotak Nifty Alpha 50 ETF", targetPct: 10, premiumSensitive: false },
  { symbol: "BFSI", name: "Mirae Asset Nifty Financial Services ETF", targetPct: 15, premiumSensitive: false },
  { symbol: "INFRAIETF", name: "ICICI Prudential Nifty Infrastructure ETF", targetPct: 15, premiumSensitive: false },
  { symbol: "MAKEINDIA", name: "Mirae Asset Nifty India Manufacturing ETF", targetPct: 15, premiumSensitive: false },
  { symbol: "MODEFENCE", name: "Motilal Oswal Nifty India Defence ETF", targetPct: 15, premiumSensitive: false },
  { symbol: "MOMIDMTM", name: "Motilal Oswal Nifty Midcap 150 Momentum 50 ETF", targetPct: 20, premiumSensitive: false },
  { symbol: "MON100", name: "Motilal Oswal NASDAQ 100 ETF", targetPct: 10, premiumSensitive: true },
];

const HOLDINGS: Holding[] = [
  { symbol: "GOLDBEES", units: 92, avgPrice: 119.06 },
  { symbol: "MIDCAPETF", units: 250, avgPrice: 23.82 },
  { symbol: "SILVERBEES", units: 20, avgPrice: 210.4 },
  { symbol: "MODEFENCE", units: 39, avgPrice: 98.33 },
  { symbol: "NIFTYBEES", units: 15, avgPrice: 278.61 },
  { symbol: "MOSMALL250", units: 166, avgPrice: 17.94 },
  { symbol: "MOMIDMTM", units: 45, avgPrice: 62.61 },
  { symbol: "INFRAIETF", units: 30, avgPrice: 96.88 },
  { symbol: "MON100", units: 7, avgPrice: 325.79 },
  { symbol: "MAKEINDIA", units: 12, avgPrice: 158.06 },
  { symbol: "JUNIORBEES", units: 2, avgPrice: 781.82 },
  { symbol: "ALPHA", units: 10, avgPrice: 49.18 },
];

/**
 * Last close, how far today's price sits below the 14-day average (negative =
 * above it), and how jumpy the walk is. Set directly against the average so
 * the ranking is a realistic contest rather than one ETF topping both marks.
 */
const SHAPES: Record<string, { level: number; belowAvg: number; vol: number }> = {
  GOLDBEES: { level: 131.2, belowAvg: -0.004, vol: 0.008 },
  MIDCAPETF: { level: 24.95, belowAvg: 0.006, vol: 0.012 },
  SILVERBEES: { level: 238.1, belowAvg: -0.009, vol: 0.016 },
  MODEFENCE: { level: 101.4, belowAvg: -0.011, vol: 0.018 },
  NIFTYBEES: { level: 287.35, belowAvg: 0.002, vol: 0.007 },
  MOSMALL250: { level: 18.62, belowAvg: 0.008, vol: 0.015 },
  MOMIDMTM: { level: 66.8, belowAvg: 0.016, vol: 0.014 },
  INFRAIETF: { level: 99.1, belowAvg: 0.005, vol: 0.011 },
  MON100: { level: 333.5, belowAvg: 0.03, vol: 0.013 },
  MAKEINDIA: { level: 162.3, belowAvg: 0.011, vol: 0.011 },
  JUNIORBEES: { level: 795.4, belowAvg: -0.001, vol: 0.009 },
  ALPHA: { level: 51.2, belowAvg: -0.004, vol: 0.013 },
  BFSI: { level: 27.4, belowAvg: 0.003, vol: 0.01 },
};

/** Small, seedable PRNG so the preview looks the same on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s: string) => Array.from(s).reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

/** `n` closes ending exactly at `level`, walked backwards with a slight uptrend. */
function walk(symbol: string, level: number, vol: number, n: number): number[] {
  const rand = mulberry32(seedOf(symbol));
  const out = [level];
  for (let i = 1; i < n; i++) {
    const shock = (rand() + rand() + rand() - 1.5) * 2 * vol;
    out.push(out[out.length - 1] / (1 + 0.0006 + shock));
  }
  return out.reverse().map((v) => Number(v.toFixed(2)));
}

function shiftSessions(iso: string, back: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  while (back > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) back--;
  }
  return d.toISOString().slice(0, 10);
}

function buildPrices(state: PreviewState, now: number): Map<string, PriceData> {
  const session = lastCompletedSession(now, new Set());
  const lastBar = state === "stale" ? shiftSessions(session, 6) : session;
  const fetchedAt = new Date(now - (state === "stale" ? 6 * 86_400_000 : 14 * 60_000)).toISOString();
  const yesterday = shiftSessions(session, 1);

  const prices = new Map<string, PriceData>();
  for (const [symbol, shape] of Object.entries(SHAPES)) {
    // BFSI is "newly listed" so the history rule has something to drop.
    const closes = walk(symbol, shape.level, shape.vol, symbol === "BFSI" ? 180 : 300);
    const avg14 = closes.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const livePrice = Number((avg14 * (1 - shape.belowAvg)).toFixed(2));

    // MODEFENCE trades 3.6% over NAV, so the premium rule has something to drop.
    const navGap = symbol === "MODEFENCE" ? 0.036 : 0.001;
    const nav = Number((livePrice / (1 + navGap)).toFixed(4));

    prices.set(symbol, {
      symbol,
      closes,
      livePrice,
      lastBar,
      nav,
      navDate: yesterday,
      // MON100 is premium-sensitive: give it a live iNAV and a premium history.
      inav: symbol === "MON100" ? Number((livePrice / 1.008).toFixed(4)) : null,
      inavAt: symbol === "MON100" ? new Date(now - 20 * 60_000).toISOString() : null,
      premiumHistory:
        symbol === "MON100" ? Array.from({ length: 120 }, (_, i) => Number((0.3 + ((i * 37) % 100) / 90).toFixed(3))) : [],
      fetchedAt,
    });
  }
  return prices;
}

export function previewSettings(state: PreviewState): Settings {
  return {
    ...DEFAULT_SETTINGS,
    budget: state === "nobuy" ? 10 : DEFAULT_SETTINGS.budget,
    nseHolidays: ["2026-10-02", "2026-10-20", "2026-11-09", "2026-12-25"],
  };
}

export function previewWatchlist(state: PreviewState): WatchlistItem[] {
  if (state === "empty") return [];
  // Targets that add to 97%, so the warning banner has something to say.
  if (state === "warn") return WATCHLIST.map((w) => (w.symbol === "MON100" ? { ...w, targetPct: 7 } : w));
  return WATCHLIST;
}

export function previewHoldings(state: PreviewState): Holding[] {
  return state === "empty" ? [] : HOLDINGS;
}

export const PREVIEW_EMAILS: AllowedEmail[] = [
  { email: "you@example.com", added_by: "schema seed", added_at: "2026-08-05T10:00:00Z" },
  { email: "partner@example.com", added_by: "you@example.com", added_at: "2026-09-12T08:30:00Z" },
];

export const PREVIEW_EMAIL = "you@example.com";

/** Everything the Advisor screen needs, scored by the real strategy. */
export function previewAdvisor(state: PreviewState) {
  const now = Date.now();
  const watchlist = previewWatchlist(state);
  const holdings = previewHoldings(state);
  const prices = buildPrices(state, now);
  const result = runStrategy({
    watchlist,
    holdings: holdings.map((h) => ({ symbol: h.symbol, units: h.units })),
    settings: previewSettings(state),
    prices,
    priceFailures: [],
    nowMs: now,
  });
  const { rows, totals } = valuePortfolio(holdings, prices, new Set(watchlist.map((w) => w.symbol)));
  return { watchlist, holdings, prices, result, rows, totals };
}
