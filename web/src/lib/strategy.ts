/**
 * The buying strategy.
 *
 * PIPELINE
 *   0. INTEGRITY       refuse everything if a HELD symbol has no price, or if
 *                      the targets don't sum to ~100 — both corrupt every weight
 *   1. DATA FRESHNESS  refuse everything if prices lag the last completed NSE
 *                      session; exclude any symbol behind the newest bar
 *   2. HISTORY         need `minCandles` daily closes
 *   3. PREMIUM         price unusually far above iNAV -> discard
 *   4. BUDGET          discard anything one unit of which busts the budget
 *   5. MARKS           two metrics, each marked 0-100 against the ETFs still in
 *                      the running:
 *                        cheapness  how far below its own 14-day average it
 *                                   trades — the deepest discount gets 100
 *                        gap        target minus current weight — the most
 *                                   underweight gets 100
 *   6. SCORE           final = 0.5 x cheapness marks + 0.5 x gap marks
 *   7. RECOMMEND       the highest score
 *
 * Marks are RELATIVE: they say how an ETF compares with the others eligible
 * today, not how cheap it is in any absolute sense. That is why the budget
 * check runs before marking — an ETF you cannot buy must not stretch the scale
 * everything else is marked on.
 *
 * Cheapness is a raw percentage, so ETFs that swing further (MON100, small
 * caps) take the top cheapness marks more often than steady ones. The gap half
 * is what stops that from concentrating the portfolio: every purchase pushes
 * the bought ETF's weight up and its gap marks down.
 *
 * All dates and times are Asia/Kolkata. The NSE is the only clock that matters.
 */

// ─── stored data ────────────────────────────────────────────────────────────

/**
 * A symbol's price data as stored in Supabase by the GitHub Action.
 * The app never fetches from Yahoo itself — see src/lib/prices.ts.
 */
export type PriceData = {
  symbol: string;
  /** Daily closes, oldest first, nulls already stripped. */
  closes: number[];
  livePrice: number;
  /** Date of the newest daily bar, ISO yyyy-mm-dd (IST). */
  lastBar: string | null;

  /**
   * End-of-day NAV from AMFI. Struck after the close, so on a Monday morning
   * the freshest value is Friday's. Used only as a fallback.
   */
  nav: number | null;
  /** Date the EOD NAV was struck, ISO yyyy-mm-dd. */
  navDate: string | null;

  /**
   * Intraday indicative NAV published by the AMC, already adjusted for
   * currency movement since the previous close. This is the correct reference
   * for a premium check — see `premiumOverFairValue`.
   */
  inav: number | null;
  /** ISO timestamp the iNAV was struck. */
  inavAt: string | null;

  /**
   * Trailing daily premium observations in percent, oldest first. The fetcher
   * appends `(close - nav) / nav * 100` once per completed session. This is the
   * baseline today's premium is ranked against.
   */
  premiumHistory: number[];

  /** When the fetcher ran, ISO string. */
  fetchedAt: string;
};

// ─── constants ──────────────────────────────────────────────────────────────

/** Completed sessions in the average today's price is judged against. */
export const CHEAPNESS_LOOKBACK = 14;

/** Share of the final score that comes from the cheapness marks. */
export const CHEAPNESS_WEIGHT = 0.5;
/** Share of the final score that comes from the allocation-gap marks. */
export const GAP_WEIGHT = 0.5;

/** What every candidate gets on a metric where they are all level. */
export const NEUTRAL_MARKS = 50;

export const NSE_TICK = 0.01; // NSE cash-segment tick size

/**
 * Below this many closes an ETF is not considered at all, whatever the
 * setting. The lowest `min_candles` the Settings page and database accept.
 */
export const ABSOLUTE_MIN_CANDLES = 60;

/** Fewer premium samples than this and the percentile gate stays quiet. */
export const MIN_PREMIUM_HISTORY = 60;

/** Targets outside 100 +/- this get a warning. */
export const TARGET_SUM_WARN_TOLERANCE = 1;
/** Targets outside 100 +/- this block the run: every gap would be skewed. */
export const TARGET_SUM_BLOCK_TOLERANCE = 5;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NSE_CLOSE_IST_MINUTE = 15 * 60 + 30; // 15:30 IST
const MS_PER_DAY = 86_400_000;

// ─── settings ───────────────────────────────────────────────────────────────

export type Settings = {
  budget: number;
  limitBufferPct: number;

  /** Absolute backstop: discard above this premium whatever the history says. */
  maxPremiumPct: number;
  /** Premiums at or below this are never gated, however statistically unusual. */
  premiumFloorPct: number;
  /** Discard when today's premium ranks above this percentile of its own year. */
  maxPremiumPctile: number;

  minCandles: number;
  /** Refuse everything if the newest bar is this many NSE sessions behind. */
  maxBarAgeSessions: number;
  /** Ignore an EOD NAV older than this many days rather than trusting it. */
  maxNavAgeDays: number;
  /** Ignore an iNAV older than this many minutes. */
  maxInavAgeMinutes: number;

  /**
   * NSE trading holidays, ISO yyyy-mm-dd. MUST be kept current from the NSE
   * holiday circular — a missing entry makes the app think a session was
   * skipped. `maxBarAgeSessions: 1` gives one session of slack to absorb a
   * single stale entry; set it to 0 once you trust this list.
   */
  nseHolidays: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  budget: 2500,
  limitBufferPct: 0.3,
  maxPremiumPct: 3,
  premiumFloorPct: 0.75,
  maxPremiumPctile: 90,
  minCandles: 252,
  maxBarAgeSessions: 1,
  maxNavAgeDays: 4,
  maxInavAgeMinutes: 120,
  nseHolidays: [],
};

// ─── result types ───────────────────────────────────────────────────────────

export type CheapnessResult = {
  /** Mean of the last CHEAPNESS_LOOKBACK completed closes. */
  recentAvg: number;
  /** (recentAvg - livePrice) / recentAvg, percent. Positive = below its average. */
  belowAvgPct: number;
  candles: number;
};

export type PremiumSource = "inav" | "nav";

export type PremiumResult = {
  /** (price - fair value) / fair value, percent. null when unjudgeable. */
  premiumPct: number | null;
  /** Where today's premium ranks in this ETF's own history. */
  premiumPctile: number | null;
  premiumSource: PremiumSource | null;
  /** The iNAV or NAV the premium was measured against. */
  referenceValue: number | null;
  referenceAt: string | null;
  premiumSamples: number;
  /** Why the premium couldn't be judged, when it couldn't. */
  premiumUnavailable: string | null;
};

export type WatchlistItem = {
  symbol: string;
  name: string;
  targetPct: number | null;
  /**
   * True for ETFs whose price can detach from NAV — international funds capped
   * by the SEBI overseas limit, thin sector funds. For these the premium gate
   * FAILS CLOSED: no usable reference value means no purchase.
   */
  premiumSensitive?: boolean;
};

export type OrderSize = { qty: number; limitPrice: number; cost: number };

export type Candidate = {
  symbol: string;
  name: string;
  livePrice: number;
  targetPct: number | null;
  currentPct: number;
  /** target - current, percentage points. Positive = underweight. 0 with no target. */
  gapPct: number;
  /** 0-100 against the other candidates; the deepest discount gets 100. */
  cheapnessMarks: number;
  /** 0-100 against the other candidates; the most underweight gets 100. */
  gapMarks: number;
  /** CHEAPNESS_WEIGHT x cheapnessMarks + GAP_WEIGHT x gapMarks. The ranking sorts on this. */
  finalScore: number;
} & OrderSize &
  CheapnessResult &
  PremiumResult;

export type Excluded = { symbol: string; name: string; reason: string };

export type HoldingRow = {
  symbol: string;
  units: number;
  price: number;
  value: number;
  weight: number;
  targetPct: number | null;
  gapPct: number | null;
  onWatchlist: boolean;
  priced: boolean;
};

export type Recommendation = Candidate & {
  leftover: number;
  /** Weight after this purchase, valued at the live price, not the limit. */
  projectedPct: number;
};

export type Freshness = {
  fetchedAt: string | null;
  ageMinutes: number | null;
  /** Newest bar date across all priced symbols. */
  latestBar: string | null;
  /** The most recent NSE session that has actually finished. */
  expectedSession: string | null;
  /** Sessions the data is behind `expectedSession`. */
  sessionsBehind: number | null;
  /** True when the data is further behind than `maxBarAgeSessions` allows. */
  missedSession: boolean;
};

export type StrategyResult = {
  generatedAt: string;
  /** IST date the run was made, for display. */
  generatedOnIst: string;
  settings: Settings;
  freshness: Freshness;
  portfolio: { rows: HoldingRow[]; total: number };
  /** Every ETF that was marked, highest score first. */
  ranked: Candidate[];
  /** Dropped by staleness, thin history, premium or budget, before marking. */
  excluded: Excluded[];
  recommendation: Recommendation | null;
  /** Set when there is no recommendation. */
  blockedReason: string | null;
  /** Non-fatal problems worth surfacing. */
  warnings: string[];
  /** Held symbols with no price. Any entry here blocks the whole run. */
  unpricedHoldings: string[];
  /** Targets should sum to 100; this is what they actually sum to. */
  targetSum: number;
};

// ─── small helpers ──────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Share of `sample` strictly below `value`, as a percentage. */
function percentileOf(sample: number[], value: number): number {
  if (sample.length === 0) return 50;
  const smaller = sample.reduce((acc, v) => acc + (v < value ? 1 : 0), 0);
  return (smaller / sample.length) * 100;
}

// ─── IST + NSE session calendar ─────────────────────────────────────────────
//
// Everything here is deliberately IST. `new Date(ms).toISOString()` is UTC and
// disagrees with the Indian date between 00:00 and 05:30 IST — harmless while
// markets are shut, but a latent bug in an IST-only app, so it is not used.

/** IST calendar date of an instant, ISO yyyy-mm-dd. */
export function istDateIso(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since IST midnight. */
function istMinuteOfDay(ms: number): number {
  const shifted = new Date(ms + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function isoToMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function shiftIso(iso: string, days: number): string {
  return new Date(isoToMs(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Calendar days between an ISO date and an instant. */
function daysSince(iso: string, toMs: number): number {
  const then = isoToMs(iso);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((toMs - then) / MS_PER_DAY);
}

export function isTradingDay(iso: string, holidays: ReadonlySet<string>): boolean {
  const dow = new Date(isoToMs(iso)).getUTCDay(); // 0 Sun ... 6 Sat
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(iso);
}

/**
 * The most recent NSE session that has FINISHED as of `now`.
 *
 * Today only counts once the 15:30 IST close has passed, so a Monday-morning
 * run correctly expects Friday's bar. This replaces raw calendar-day counting,
 * which false-blocked after every long weekend and NSE holiday.
 */
export function lastCompletedSession(now: number, holidays: ReadonlySet<string>): string {
  const today = istDateIso(now);
  if (isTradingDay(today, holidays) && istMinuteOfDay(now) >= NSE_CLOSE_IST_MINUTE) {
    return today;
  }
  let iso = shiftIso(today, -1);
  for (let guard = 0; guard < 3650 && !isTradingDay(iso, holidays); guard++) {
    iso = shiftIso(iso, -1);
  }
  return iso;
}

/** Trading sessions strictly after `fromIso`, up to and including `toIso`. */
export function sessionsBetween(
  fromIso: string,
  toIso: string,
  holidays: ReadonlySet<string>,
): number {
  if (fromIso >= toIso) return 0;
  let count = 0;
  let iso = shiftIso(fromIso, 1);
  for (let guard = 0; iso <= toIso && guard < 3650; guard++) {
    if (isTradingDay(iso, holidays)) count++;
    iso = shiftIso(iso, 1);
  }
  return count;
}

// ─── cheapness ──────────────────────────────────────────────────────────────

/**
 * How far the live price sits below this ETF's average close over the last
 * CHEAPNESS_LOOKBACK completed sessions. Positive = cheaper than it has been
 * lately; negative = dearer.
 */
export function scoreCheapness(
  closes: number[],
  livePrice: number,
  opts: {
    /**
     * True when the newest stored close is today's own bar, so the live price
     * supersedes it rather than following it. During market hours Yahoo's last
     * daily bar IS today, and averaging it in would compare today's price
     * partly against itself.
     */
    lastCloseIsToday?: boolean;
  } = {},
): CheapnessResult {
  const completed =
    opts.lastCloseIsToday && closes.length > 1 ? closes.slice(0, -1) : closes;
  const recentAvg = mean(completed.slice(-CHEAPNESS_LOOKBACK));

  return {
    recentAvg,
    belowAvgPct: recentAvg > 0 ? ((recentAvg - livePrice) / recentAvg) * 100 : 0,
    candles: closes.length,
  };
}

/**
 * Marks out of 100 against the other candidates: the highest value gets 100,
 * the lowest 0, and the rest in proportion to where they fall between. When
 * every value is the same the metric cannot separate anyone, so all get
 * NEUTRAL_MARKS — which also covers a single candidate.
 */
export function scaleMarks(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Not `hi === lo`: a spread of float noise would otherwise be stretched to 0-100.
  if (hi - lo < 1e-9) return values.map(() => NEUTRAL_MARKS);
  return values.map((v) => ((v - lo) / (hi - lo)) * 100);
}

// ─── premium over fair value ────────────────────────────────────────────────

/**
 * How far the market price sits above the fund's underlying value.
 *
 * WHY iNAV, NOT AMFI EOD NAV.
 * AMFI publishes NAV after the close, so on a Monday morning the freshest value
 * is Friday's — struck off THURSDAY's Nasdaq close for a US-tracking ETF. A
 * "premium" measured against it contains two Nasdaq sessions plus two days of
 * INR/USD drift, mixed inseparably with the structural premium we actually want
 * to catch. Both error directions are live: Nasdaq up 3% since the strike and a
 * fair-priced ETF looks expensive; down 3% and a real 5% premium reads as 2%
 * and sails through. No fixed threshold can fix that, because the noise exceeds
 * the signal. The AMC's iNAV is currency-adjusted and intraday, which is the
 * correction that's missing.
 *
 * WHY A PERCENTILE, NOT A FIXED THRESHOLD.
 * Every ETF has its own baseline. NIFTYBEES lives within a few basis points of
 * NAV; a capped international ETF can sit structurally above it for months.
 * Ranking today's premium against the ETF's own trailing year is
 * self-calibrating.
 *
 * `premiumFloorPct` stops the percentile firing on noise: a 0.2% premium may be
 * NIFTYBEES's 97th percentile and still be completely harmless.
 * `maxPremiumPct` is an absolute backstop for when history is short or the whole
 * distribution has drifted up.
 */
export function premiumOverFairValue(
  price: PriceData,
  settings: Settings,
  now: number,
): PremiumResult {
  const samples = price.premiumHistory ?? [];

  const base: PremiumResult = {
    premiumPct: null,
    premiumPctile: null,
    premiumSource: null,
    referenceValue: null,
    referenceAt: null,
    premiumSamples: samples.length,
    premiumUnavailable: null,
  };

  // ── preferred: intraday, currency-adjusted iNAV ──
  if (price.inav !== null && Number.isFinite(price.inav) && price.inav > 0) {
    const struck = price.inavAt ? Date.parse(price.inavAt) : NaN;
    const ageMinutes = Number.isFinite(struck)
      ? Math.floor((now - struck) / 60_000)
      : null;

    if (ageMinutes === null || ageMinutes <= settings.maxInavAgeMinutes) {
      const premiumPct = ((price.livePrice - price.inav) / price.inav) * 100;
      return {
        ...base,
        premiumPct,
        premiumPctile:
          samples.length >= MIN_PREMIUM_HISTORY
            ? percentileOf(samples, premiumPct)
            : null,
        premiumSource: "inav",
        referenceValue: price.inav,
        referenceAt: price.inavAt,
      };
    }
  }

  // ── fallback: EOD NAV, explicitly flagged as the weaker reference ──
  if (price.nav !== null && Number.isFinite(price.nav) && price.nav > 0) {
    const ageDays = price.navDate ? daysSince(price.navDate, now) : null;
    if (ageDays !== null && ageDays > settings.maxNavAgeDays) {
      return {
        ...base,
        referenceValue: price.nav,
        referenceAt: price.navDate,
        premiumUnavailable: `NAV is ${ageDays} days old (limit ${settings.maxNavAgeDays}) and no fresh iNAV`,
      };
    }
    const premiumPct = ((price.livePrice - price.nav) / price.nav) * 100;
    return {
      ...base,
      premiumPct,
      premiumPctile:
        samples.length >= MIN_PREMIUM_HISTORY
          ? percentileOf(samples, premiumPct)
          : null,
      premiumSource: "nav",
      referenceValue: price.nav,
      referenceAt: price.navDate,
    };
  }

  return { ...base, premiumUnavailable: "no iNAV or NAV published for this ETF" };
}

/** null when the premium is acceptable, otherwise the reason to discard. */
export function premiumVerdict(
  premium: PremiumResult,
  settings: Settings,
  premiumSensitive: boolean,
): string | null {
  if (premium.premiumPct === null) {
    // Fail closed only where the price can genuinely detach from NAV.
    return premiumSensitive
      ? `premium cannot be checked (${premium.premiumUnavailable}) and this ETF can trade far from NAV`
      : null;
  }

  const shown = premium.premiumPct.toFixed(2);
  const ref = premium.referenceValue?.toFixed(2) ?? "?";
  const src = premium.premiumSource === "inav" ? "iNAV" : "EOD NAV";

  if (premium.premiumPct > settings.maxPremiumPct) {
    return (
      `trading ${shown}% above ${src} Rs.${ref}, past the ${settings.maxPremiumPct}% ` +
      `absolute limit — you would be paying well over the underlying value`
    );
  }

  if (
    premium.premiumPctile !== null &&
    premium.premiumPct > settings.premiumFloorPct &&
    premium.premiumPctile > settings.maxPremiumPctile
  ) {
    return (
      `${shown}% above ${src} Rs.${ref} is the ${premium.premiumPctile.toFixed(0)}th ` +
      `percentile of its own ${premium.premiumSamples}-session history ` +
      `(limit ${settings.maxPremiumPctile}th) — unusually expensive for this ETF`
    );
  }

  return null;
}

// ─── sizing ─────────────────────────────────────────────────────────────────

export function sizeOrder(
  livePrice: number,
  budget: number,
  limitBufferPct: number,
): OrderSize {
  const raw = livePrice * (1 + limitBufferPct / 100);
  const limitPrice = Math.round(raw / NSE_TICK) * NSE_TICK;
  const rounded = Number(limitPrice.toFixed(2));
  if (rounded <= 0) return { qty: 0, limitPrice: 0, cost: 0 };
  const qty = Math.floor(budget / rounded);
  return { qty, limitPrice: rounded, cost: Number((qty * rounded).toFixed(2)) };
}

// ─── the pipeline ───────────────────────────────────────────────────────────

export type StrategyInput = {
  watchlist: WatchlistItem[];
  holdings: Array<{ symbol: string; units: number }>;
  settings: Settings;
  prices: Map<string, PriceData>;
  priceFailures: Array<{ symbol: string; error: string }>;
  /** Injectable for tests. Defaults to now. */
  nowMs?: number;
};

export function runStrategy(input: StrategyInput): StrategyResult {
  const { watchlist, holdings, settings, prices } = input;
  const now = input.nowMs ?? Date.now();
  const holidays = new Set(settings.nseHolidays);

  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const targetOf = new Map(watchlist.map((w) => [w.symbol, w.targetPct]));
  const failureOf = new Map(input.priceFailures.map((f) => [f.symbol, f.error]));
  const targetSum = watchlist.reduce((s, w) => s + (w.targetPct ?? 0), 0);

  const warnings: string[] = [];

  // ── freshness, measured in NSE sessions rather than calendar days ──
  let latestBarMs: number | null = null;
  let newestFetch: number | null = null;
  for (const price of prices.values()) {
    if (price.lastBar) {
      const t = isoToMs(price.lastBar);
      if (Number.isFinite(t) && (latestBarMs === null || t > latestBarMs)) latestBarMs = t;
    }
    const f = Date.parse(price.fetchedAt);
    if (Number.isFinite(f) && (newestFetch === null || f > newestFetch)) newestFetch = f;
  }
  const latestBar =
    latestBarMs === null ? null : new Date(latestBarMs).toISOString().slice(0, 10);
  const expectedSession = lastCompletedSession(now, holidays);
  const sessionsBehind =
    latestBar === null ? null : sessionsBetween(latestBar, expectedSession, holidays);
  const missedSession =
    sessionsBehind !== null && sessionsBehind > settings.maxBarAgeSessions;

  const freshness: Freshness = {
    fetchedAt: newestFetch === null ? null : new Date(newestFetch).toISOString(),
    ageMinutes: newestFetch === null ? null : Math.round((now - newestFetch) / 60_000),
    latestBar,
    expectedSession,
    sessionsBehind,
    missedSession,
  };

  // ── portfolio table ──
  const tableSymbols = Array.from(
    new Set([...holdings.map((h) => h.symbol), ...watchSymbols]),
  ).sort();
  const unitsOf = new Map(holdings.map((h) => [h.symbol, h.units]));

  let total = 0;
  const rows: HoldingRow[] = tableSymbols.map((symbol) => {
    const units = unitsOf.get(symbol) ?? 0;
    const priceData = prices.get(symbol);
    const price = priceData?.livePrice ?? 0;
    const value = units * price;
    total += value;
    return {
      symbol,
      units,
      price,
      value,
      weight: 0,
      targetPct: targetOf.get(symbol) ?? null,
      gapPct: null,
      onWatchlist: watchSymbols.has(symbol),
      priced: priceData !== undefined,
    };
  });
  for (const row of rows) {
    row.weight = total > 0 ? (row.value / total) * 100 : 0;
    row.gapPct = row.targetPct === null ? null : row.targetPct - row.weight;
  }
  rows.sort((a, b) => b.value - a.value);
  const weightOf = new Map(rows.map((r) => [r.symbol, r.weight]));

  // ── PRIORITY 1: a held symbol with no price corrupts everything ──
  //
  // Its value falls out of `total`, which inflates every other symbol's weight,
  // which shrinks every gapPct, which skews every gap mark. The recommendation
  // would be confidently wrong with nothing on screen to say so. Refuse.
  const unpricedHoldings = rows
    .filter((r) => r.units > 0 && !r.priced)
    .map((r) => r.symbol);

  // ── targets must sum to ~100 or every gap is biased ──
  // Only once any are set: with none, every gap is zero and nothing is skewed.
  const anyTargets = watchlist.some((w) => w.targetPct !== null);
  const targetDrift = Math.abs(targetSum - 100);
  const targetsUnusable = anyTargets && targetDrift > TARGET_SUM_BLOCK_TOLERANCE;
  if (anyTargets && targetDrift > TARGET_SUM_WARN_TOLERANCE && !targetsUnusable) {
    warnings.push(
      `Targets sum to ${targetSum.toFixed(1)}%, not 100% — every allocation gap is skewed by ${(100 - targetSum).toFixed(1)}pp.`,
    );
  }

  // ── filter the watchlist down to what could actually be bought ──
  type Eligible = Omit<Candidate, "cheapnessMarks" | "gapMarks" | "finalScore">;
  const eligible: Eligible[] = [];
  const excluded: Excluded[] = [];
  const minCandles = Math.max(ABSOLUTE_MIN_CANDLES, settings.minCandles);
  const todayIst = istDateIso(now);

  for (const { symbol, name, targetPct, premiumSensitive } of watchlist) {
    const priceData = prices.get(symbol);
    if (!priceData) {
      excluded.push({
        symbol,
        name,
        reason: failureOf.get(symbol) ?? "no price stored yet",
      });
      continue;
    }

    // 1. staleness — this symbol must be on the newest session we have.
    if (latestBar && priceData.lastBar && priceData.lastBar < latestBar) {
      excluded.push({
        symbol,
        name,
        reason: `price is from ${priceData.lastBar}, but the latest session on file is ${latestBar}`,
      });
      continue;
    }
    if (latestBar && !priceData.lastBar) {
      excluded.push({ symbol, name, reason: "no session date on the stored price" });
      continue;
    }

    // 2. history
    if (priceData.closes.length < minCandles) {
      excluded.push({
        symbol,
        name,
        reason: `only ${priceData.closes.length} daily closes, need ${minCandles}`,
      });
      continue;
    }

    // 3. premium over fair value
    const premium = premiumOverFairValue(priceData, settings, now);
    const verdict = premiumVerdict(premium, settings, premiumSensitive === true);
    if (verdict !== null) {
      excluded.push({ symbol, name, reason: verdict });
      continue;
    }
    if (premiumSensitive && premium.premiumSource === "nav") {
      warnings.push(
        `${symbol}: no fresh iNAV, so its premium was measured against an end-of-day NAV — that number carries a day of index and currency drift.`,
      );
    }

    // 4. budget — before marking, so an ETF you cannot buy never stretches the
    //    scale the others are marked on.
    const order = sizeOrder(priceData.livePrice, settings.budget, settings.limitBufferPct);
    if (order.qty < 1) {
      excluded.push({
        symbol,
        name,
        reason: `one unit costs Rs.${order.limitPrice.toFixed(2)}, over the Rs.${settings.budget.toFixed(2)} budget`,
      });
      continue;
    }

    const currentPct = weightOf.get(symbol) ?? 0;
    eligible.push({
      symbol,
      name,
      livePrice: priceData.livePrice,
      targetPct,
      currentPct,
      gapPct: targetPct === null ? 0 : targetPct - currentPct,
      ...order,
      ...scoreCheapness(priceData.closes, priceData.livePrice, {
        lastCloseIsToday: priceData.lastBar === todayIst,
      }),
      ...premium,
    });
  }

  // ── 5-6. mark each metric against the field, then combine ──
  const cheapnessMarks = scaleMarks(eligible.map((e) => e.belowAvgPct));
  const gapMarks = scaleMarks(eligible.map((e) => e.gapPct));
  const ranked: Candidate[] = eligible.map((e, i) => ({
    ...e,
    cheapnessMarks: cheapnessMarks[i],
    gapMarks: gapMarks[i],
    finalScore: CHEAPNESS_WEIGHT * cheapnessMarks[i] + GAP_WEIGHT * gapMarks[i],
  }));
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // ── 7. recommend — only once every integrity gate clears ──
  const canRecommend =
    !missedSession && unpricedHoldings.length === 0 && !targetsUnusable;
  const top = canRecommend ? ranked[0] : undefined;

  let recommendation: Recommendation | null = null;
  if (top) {
    // Value acquired is qty x LIVE price. `cost` uses the limit price, which
    // is deliberately above live, and would overstate the projected weight.
    const valueAdded = top.qty * top.livePrice;
    const held = (unitsOf.get(top.symbol) ?? 0) * top.livePrice;
    const newTotal = total + valueAdded;
    recommendation = {
      ...top,
      leftover: Number((settings.budget - top.cost).toFixed(2)),
      projectedPct: newTotal > 0 ? ((held + valueAdded) / newTotal) * 100 : 0,
    };
  }

  let blockedReason: string | null = null;
  if (!recommendation) {
    if (unpricedHoldings.length > 0) {
      blockedReason =
        `Refusing to recommend: no price for ${unpricedHoldings.join(", ")}, which you hold. ` +
        `Those holdings would be valued at zero, inflating every other weight and skewing ` +
        `every allocation gap. Fix the fetcher before trading.`;
    } else if (targetsUnusable) {
      blockedReason =
        `Refusing to recommend: targets sum to ${targetSum.toFixed(1)}%, not 100%. ` +
        `Every allocation gap is off by ${(100 - targetSum).toFixed(1)}pp, so the ranking is meaningless.`;
    } else if (missedSession) {
      blockedReason =
        `Refusing to recommend: the newest price data is from ${latestBar}, but the last ` +
        `completed NSE session was ${expectedSession} — ${sessionsBehind} session(s) behind, ` +
        `past the ${settings.maxBarAgeSessions}-session limit. Run the fetcher.`;
    } else if (watchlist.length === 0) {
      blockedReason = "Your watchlist is empty — add some ETFs first.";
    } else if (prices.size === 0) {
      blockedReason = "No price data stored yet. Run the fetcher.";
    } else {
      blockedReason =
        "Nothing eligible: every watchlist ETF was excluded — see the reasons below.";
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    generatedOnIst: todayIst,
    settings,
    freshness,
    portfolio: { rows, total },
    ranked,
    excluded,
    recommendation,
    blockedReason,
    warnings,
    unpricedHoldings,
    targetSum,
  };
}
