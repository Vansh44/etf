/**
 * The buying strategy.
 *
 * PIPELINE
 *   0. INTEGRITY       refuse everything if a HELD symbol has no price, or if
 *                      the targets don't sum to ~100 — both corrupt every weight
 *   1. DATA FRESHNESS  refuse everything if prices lag the last completed NSE
 *                      session; exclude any symbol behind the newest bar
 *   2. HISTORY         need `minCandles` daily closes; below the 252-session
 *                      scoring window, cheapness is discounted for confidence
 *   3. TREND           above the 50-day avg          -> keep
 *                      below 50-day, above 14-day     -> keep (turning up)
 *                      below both                     -> discard, still falling
 *   4. PREMIUM         price unusually far above iNAV -> discard
 *   5. SCORE           final = cheapness x confidence + shapedGap
 *   6. BUDGET          skip anything one unit of which busts the budget
 *   7. RECOMMEND       the highest-scoring candidate that fits
 *
 * Cheapness answers "is this a good moment to buy?"; the allocation gap answers
 * "which holding needs the money?". There is no hard concentration cap — an
 * overweight ETF earns a negative gap, and that penalty grows QUADRATICALLY
 * once the drift passes `gapKneePct`, so extreme overweights are effectively
 * unbuyable without a cliff edge in the ranking.
 *
 * Cheapness is measured against each ETF's OWN history, never against the other
 * ETFs, so a volatile ETF and a steady one are comparable. The score is
 * scale-invariant: the rupee price level carries no information.
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

export const PRICE_WINDOW = 252; // trailing sessions for the price percentile
export const HIGH_LOOKBACK = 50; // sessions in the drawdown lookback
export const MIN_DD_HISTORY = 20; // fewer drawdown samples -> score it neutral
export const TREND_LONG = 50; // first trend test
export const TREND_SHORT = 14; // second chance
export const NSE_TICK = 0.01; // NSE cash-segment tick size

/** Below this many closes an ETF is not scored at all, whatever the setting. */
export const ABSOLUTE_MIN_CANDLES = 60;

/**
 * How much of `cheapness` comes from where the price sits in its own trailing
 * range, versus how unusual today's dip is.
 *
 * `pricePctile` is a TREND-LEVEL measure: anything in a sustained uptrend reads
 * high on it forever. That double-penalises a strong compounder, because the
 * same rising price also drives its weight up and its allocation gap negative —
 * two independent-looking penalties from one cause. `ddPctile` has no such
 * problem: it ranks today's drawdown against the ETF's own drawdown
 * distribution, so it is genuinely mean-reverting and orthogonal to trend.
 * Hence the 25/75 split — let the gap term do the rebalancing it was built for.
 */
export const PRICE_PCTILE_WEIGHT = 0.25;

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

  /** Score points per percentage point of allocation gap, inside the knee. */
  gapWeight: number;
  /**
   * |gap| in percentage points beyond which the penalty turns quadratic.
   * Inside the knee the term is linear and barely disturbs normal operation;
   * outside it, drift gets expensive fast.
   */
  gapKneePct: number;

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
  gapWeight: 1.5,
  gapKneePct: 5,
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

export type TrendBranch = "above-long" | "above-short" | "below-both" | "no-data";

export type TrendResult = {
  keep: boolean;
  branch: TrendBranch;
  label: string;
  detail: string;
  dmaLong: number | null;
  dmaShort: number | null;
};

export type CheapnessResult = {
  cheapness: number;
  pricePctile: number;
  ddNow: number;
  ddPctile: number;
  lastClose: number;
  /** 0-1. How much of the 252-session window this ETF's history covers. */
  confidence: number;
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

export type Candidate = {
  symbol: string;
  name: string;
  livePrice: number;
  targetPct: number | null;
  currentPct: number;
  /** target - current, percentage points. Positive = underweight. */
  gapPct: number;
  /** cheapness x confidence */
  cheapnessAdjusted: number;
  /** The shaped (linear inside the knee, quadratic outside) gap term. */
  gapContribution: number;
  /** The number the ranking sorts on. */
  finalScore: number;
} & CheapnessResult &
  PremiumResult &
  Pick<TrendResult, "branch" | "label" | "detail" | "dmaLong" | "dmaShort">;

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

export type Recommendation = {
  symbol: string;
  name: string;
  qty: number;
  limitPrice: number;
  cost: number;
  leftover: number;
  /** Weight after this purchase, valued at the live price, not the limit. */
  projectedPct: number;
} & Omit<Candidate, "name" | "symbol">;

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
  ranked: Candidate[];
  /** Dropped by staleness, thin history, trend or premium. */
  excluded: Excluded[];
  /** Passed scoring but skipped during the buy walk. */
  skipped: Array<{ symbol: string; reason: string }>;
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

function movingAverage(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return mean(closes.slice(-period));
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

// ─── trend ──────────────────────────────────────────────────────────────────

/**
 * The trend rule, in the order it was specified.
 * Reduces to: discard only when the price is under BOTH averages.
 */
export function passesTrend(closes: number[], livePrice: number): TrendResult {
  const dmaLong = movingAverage(closes, TREND_LONG);
  const dmaShort = movingAverage(closes, TREND_SHORT);

  if (dmaLong === null || dmaShort === null) {
    return {
      keep: false,
      branch: "no-data",
      label: "no data",
      detail: "not enough history for the moving averages",
      dmaLong,
      dmaShort,
    };
  }

  const px = livePrice.toFixed(2);

  if (livePrice > dmaLong) {
    return {
      keep: true,
      branch: "above-long",
      label: `>${TREND_LONG}D`,
      detail: `Rs.${px} above its ${TREND_LONG}-day avg Rs.${dmaLong.toFixed(2)}`,
      dmaLong,
      dmaShort,
    };
  }

  if (livePrice > dmaShort) {
    return {
      keep: true,
      branch: "above-short",
      label: `>${TREND_SHORT}D`,
      detail:
        `Rs.${px} under its ${TREND_LONG}-day avg Rs.${dmaLong.toFixed(2)} but above its ` +
        `${TREND_SHORT}-day avg Rs.${dmaShort.toFixed(2)} — turning up`,
      dmaLong,
      dmaShort,
    };
  }

  return {
    keep: false,
    branch: "below-both",
    label: "below both",
    detail:
      `Rs.${px} under both its ${TREND_LONG}-day avg Rs.${dmaLong.toFixed(2)} and ` +
      `${TREND_SHORT}-day avg Rs.${dmaShort.toFixed(2)} — still falling`,
    dmaLong,
    dmaShort,
  };
}

// ─── cheapness ──────────────────────────────────────────────────────────────

/**
 * Cheapness 0-100, higher = cheaper, scored against this ETF's own history.
 *
 *   A. where the live price sits in its own trailing 1-year range of closes
 *      (0 = at its 52-week low)          -> contributes 100 - percentile
 *   B. today's drawdown from its `HIGH_LOOKBACK`-session high, ranked against
 *      its own past year of drawdowns    -> contributes that percentile
 *
 *   cheapness = A x PRICE_PCTILE_WEIGHT + B x (1 - PRICE_PCTILE_WEIGHT)
 *
 * DRAWDOWN WINDOW CONSISTENCY — subtle, and easy to get wrong.
 * Each historical sample is `max(closes[i-look+1 .. i])` — `look` observations
 * *including* closes[i] itself. Today's live price plays exactly the role
 * closes[i] plays, so its window must also be `look` observations including
 * itself: `look - 1` prior closes plus the live price. Using the last `look`
 * closes plus the live price would give today `look + 1`, making today's
 * drawdown systematically deeper than the history it is ranked against and
 * inflating every dip percentile.
 */
export function scoreCheapness(
  closes: number[],
  livePrice: number,
  opts: {
    /**
     * True when the newest stored close is today's own bar, so the live price
     * supersedes it rather than following it. During market hours Yahoo's last
     * daily bar IS today, and counting both would put today in the window twice
     * while pushing the oldest day out — a second, quieter inconsistency.
     */
    lastCloseIsToday?: boolean;
  } = {},
): CheapnessResult {
  const rawCount = closes.length;

  // Completed bars only. The live price stands in for the current bar.
  const completed =
    opts.lastCloseIsToday && closes.length > 1 ? closes.slice(0, -1) : closes;

  const n = completed.length;
  const window = Math.min(PRICE_WINDOW, n);
  const look = Math.min(HIGH_LOOKBACK, n + 1);

  // ── A. price position in its own trailing range ──
  const recent = completed.slice(-window);
  const below = recent.reduce((acc, c) => acc + (c < livePrice ? 1 : 0), 0);
  const pricePctile = (below / recent.length) * 100;

  // ── B. how unusual today's dip is, on an IDENTICAL window ──
  // Today: (look - 1) prior completed closes + the live price = `look` values.
  // History: closes[i-look+1 .. i]                            = `look` values.
  const priorCloses = look > 1 ? completed.slice(-(look - 1)) : [];
  const recentHigh = Math.max(...priorCloses, livePrice);
  const ddNow = recentHigh > 0 ? ((recentHigh - livePrice) / recentHigh) * 100 : 0;

  const ddHistory: number[] = [];
  for (let i = look - 1; i < n; i++) {
    const windowHigh = Math.max(...completed.slice(i - look + 1, i + 1));
    if (windowHigh > 0) ddHistory.push(((windowHigh - completed[i]) / windowHigh) * 100);
  }
  const ddRecent = ddHistory.slice(-window);

  // Needs n >= 69 to clear MIN_DD_HISTORY at look = 50. Below that the dip
  // signal is neutral and the score rests almost entirely on allocation.
  const ddPctile =
    ddRecent.length >= MIN_DD_HISTORY ? percentileOf(ddRecent, ddNow) : 50;

  return {
    cheapness:
      (100 - pricePctile) * PRICE_PCTILE_WEIGHT +
      ddPctile * (1 - PRICE_PCTILE_WEIGHT),
    pricePctile,
    ddNow,
    ddPctile,
    lastClose: completed[n - 1],
    // A score built on a 252-session window can only be fully trusted with 252
    // sessions of history. Below that, discount it rather than pretend.
    confidence: Math.min(1, rawCount / PRICE_WINDOW),
    candles: rawCount,
  };
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
 * self-calibrating, and matches how `ddPctile` already works.
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

// ─── allocation gap shaping ─────────────────────────────────────────────────

/**
 * Linear inside the knee, quadratic outside it.
 *
 * The old hard concentration cap was crude but it BOUNDED the failure. Without
 * it, a linear gap term loses to cheapness: cheapness ranges roughly 30-70
 * while a +/-5pp gap at gapWeight 1.5 moves the score only +/-7.5, so cheapness
 * outvotes allocation about 5:1. Gold at 25% against a 10% target would score
 * 80 x 1.0 - 22.5 = 57.5 and still beat an on-target NIFTYBEES at 50.
 *
 * Shaping fixes it without a cliff: `mag + excess^2 / knee` is continuous in
 * both value and slope at the knee, so normal operation is untouched, while
 * that same 15pp overweight now costs 52.5 and cannot win.
 */
export function shapeGap(gapPct: number, gapWeight: number, kneePct: number): number {
  const knee = Math.max(0.01, kneePct);
  const mag = Math.abs(gapPct);
  if (mag <= knee) return gapWeight * gapPct;
  const excess = mag - knee;
  const shaped = mag + (excess * excess) / knee;
  return Math.sign(gapPct) * gapWeight * shaped;
}

// ─── sizing ─────────────────────────────────────────────────────────────────

export function sizeOrder(
  livePrice: number,
  budget: number,
  limitBufferPct: number,
): { qty: number; limitPrice: number; cost: number } {
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
  // which shrinks every gapPct, which skews every finalScore. The recommendation
  // would be confidently wrong with nothing on screen to say so. Refuse.
  const unpricedHoldings = rows
    .filter((r) => r.units > 0 && !r.priced)
    .map((r) => r.symbol);

  // ── targets must sum to ~100 or every gap is biased ──
  const targetDrift = Math.abs(targetSum - 100);
  const targetsUnusable =
    watchlist.some((w) => w.targetPct !== null) &&
    targetDrift > TARGET_SUM_BLOCK_TOLERANCE;
  if (targetDrift > TARGET_SUM_WARN_TOLERANCE && !targetsUnusable) {
    warnings.push(
      `Targets sum to ${targetSum.toFixed(1)}%, not 100% — every allocation gap is skewed by ${(100 - targetSum).toFixed(1)}pp.`,
    );
  }

  // ── score the watchlist ──
  const ranked: Candidate[] = [];
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

    // 3. trend
    const trend = passesTrend(priceData.closes, priceData.livePrice);
    if (!trend.keep) {
      excluded.push({ symbol, name, reason: trend.detail });
      continue;
    }

    // 4. premium over fair value
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

    // 5. score
    const score = scoreCheapness(priceData.closes, priceData.livePrice, {
      lastCloseIsToday: priceData.lastBar === todayIst,
    });
    const currentPct = weightOf.get(symbol) ?? 0;
    const gapPct = targetPct === null ? 0 : targetPct - currentPct;
    const cheapnessAdjusted = score.cheapness * score.confidence;
    const gapContribution = shapeGap(gapPct, settings.gapWeight, settings.gapKneePct);

    ranked.push({
      symbol,
      name,
      livePrice: priceData.livePrice,
      targetPct,
      currentPct,
      gapPct,
      cheapnessAdjusted,
      gapContribution,
      finalScore: cheapnessAdjusted + gapContribution,
      branch: trend.branch,
      label: trend.label,
      detail: trend.detail,
      dmaLong: trend.dmaLong,
      dmaShort: trend.dmaShort,
      ...score,
      ...premium,
    });
  }

  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // ── the buy walk ──
  const skipped: Array<{ symbol: string; reason: string }> = [];
  let recommendation: Recommendation | null = null;

  // Every integrity gate clears before anything is named to buy.
  const canRecommend =
    !missedSession && unpricedHoldings.length === 0 && !targetsUnusable;

  if (canRecommend) {
    for (const candidate of ranked) {
      const { qty, limitPrice, cost } = sizeOrder(
        candidate.livePrice,
        settings.budget,
        settings.limitBufferPct,
      );
      if (qty < 1) {
        skipped.push({
          symbol: candidate.symbol,
          reason: `one unit costs Rs.${limitPrice.toFixed(2)}, over the Rs.${settings.budget.toFixed(2)} budget`,
        });
        continue;
      }

      // Value acquired is qty x LIVE price. `cost` uses the limit price, which
      // is deliberately above live, and would overstate the projected weight.
      const valueAdded = qty * candidate.livePrice;
      const held = (unitsOf.get(candidate.symbol) ?? 0) * candidate.livePrice;
      const newTotal = total + valueAdded;
      const { symbol: _s, name: _n, ...rest } = candidate;

      recommendation = {
        ...rest,
        symbol: candidate.symbol,
        name: candidate.name,
        qty,
        limitPrice,
        cost,
        leftover: Number((settings.budget - cost).toFixed(2)),
        projectedPct: newTotal > 0 ? ((held + valueAdded) / newTotal) * 100 : 0,
      };
      break;
    }
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
    } else if (ranked.length === 0) {
      blockedReason =
        "Nothing eligible: every watchlist ETF was excluded — see the reasons below.";
    } else {
      blockedReason = `Nothing affordable: one unit of every candidate costs more than Rs.${settings.budget.toFixed(2)}.`;
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
    skipped,
    recommendation,
    blockedReason,
    warnings,
    unpricedHoldings,
    targetSum,
  };
}