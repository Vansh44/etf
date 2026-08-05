/**
 * The buying strategy.
 *
 * PIPELINE
 *   1. DATA FRESHNESS  refuse everything if prices missed a trading session;
 *                      exclude any symbol whose bar lags the newest one
 *   2. HISTORY         need `minCandles` daily closes; below the 252-session
 *                      scoring window, cheapness is discounted for confidence
 *   3. TREND           above the 50-day avg          -> keep
 *                      below 50-day, above 14-day     -> keep (turning up)
 *                      below both                     -> discard, still falling
 *   4. PREMIUM         market price too far above NAV -> discard
 *   5. SCORE           final = cheapness x confidence + gapWeight x allocationGap
 *   6. BUDGET          skip anything one unit of which busts the budget
 *   7. RECOMMEND       the highest-scoring candidate that fits
 *
 * Cheapness answers "is this a good moment to buy?"; the allocation gap answers
 * "which holding needs the money?". There is deliberately no hard concentration
 * cap any more — an overweight ETF earns a NEGATIVE gap, which lowers its score,
 * rather than being blocked outright.
 *
 * Cheapness is measured against each ETF's OWN history, never against the other
 * ETFs, so a volatile ETF and a steady one are comparable. The score is
 * scale-invariant: the rupee price level carries no information.
 */

/**
 * A symbol's price data as stored in Supabase by the GitHub Action.
 * The app never fetches from Yahoo itself — see src/lib/prices.ts.
 */
export type PriceData = {
  symbol: string;
  /** Daily closes, oldest first, nulls already stripped. */
  closes: number[];
  livePrice: number;
  /** Date of the newest daily bar, ISO yyyy-mm-dd. */
  lastBar: string | null;
  /** Net asset value per unit, from AMFI. null when unavailable. */
  nav: number | null;
  /** Date the NAV was struck. Can legitimately lag the price by a day. */
  navDate: string | null;
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

export type Settings = {
  budget: number;
  limitBufferPct: number;
  /** Rupee-points of allocation gap per point of cheapness. */
  gapWeight: number;
  /** Discard if the market price exceeds NAV by more than this. */
  maxPremiumPct: number;
  /** Closes required for a full-confidence score. */
  minCandles: number;
  /** Refuse everything if the newest bar is older than this many days. */
  maxBarAgeDays: number;
  /** Ignore a NAV older than this many days rather than trusting it. */
  maxNavAgeDays: number;
};

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
  /** 0-1. How much of the 252-session window this ETF's history actually covers. */
  confidence: number;
  candles: number;
};

export type PremiumResult = {
  /** (price - nav) / nav, in percent. null when NAV is unusable. */
  premiumPct: number | null;
  nav: number | null;
  navDate: string | null;
  navAgeDays: number | null;
  /** Why the premium couldn't be judged, when it couldn't. */
  unavailable: string | null;
};

export type Candidate = {
  symbol: string;
  name: string;
  livePrice: number;
  /** Target allocation, or null when none is set. */
  targetPct: number | null;
  currentPct: number;
  /** target - current, in percentage points. Positive = underweight. */
  gapPct: number;
  /** cheapness x confidence */
  cheapnessAdjusted: number;
  /** gapWeight x gapPct */
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
  /** Weight after this purchase, so you can see it move toward target. */
  projectedPct: number;
} & Omit<Candidate, "name" | "symbol">;

export type Freshness = {
  fetchedAt: string | null;
  ageMinutes: number | null;
  /** Newest bar date across all priced symbols — our best view of "latest session". */
  latestBar: string | null;
  latestBarAgeDays: number | null;
  /** True when the data clearly missed at least one session. */
  missedSession: boolean;
};

export type StrategyResult = {
  generatedAt: string;
  settings: Settings;
  freshness: Freshness;
  portfolio: { rows: HoldingRow[]; total: number };
  ranked: Candidate[];
  /** Dropped by the trend rule, staleness, premium or thin history. */
  excluded: Excluded[];
  /** Passed scoring but skipped during the buy walk. */
  skipped: Array<{ symbol: string; reason: string }>;
  recommendation: Recommendation | null;
  /** Set when there is no recommendation. */
  blockedReason: string | null;
  /** Targets should sum to 100; this is what they actually sum to. */
  targetSum: number;
};

// ─── helpers ────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function movingAverage(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return mean(closes.slice(-period));
}

function daysBetween(fromIso: string, toMs: number): number {
  const then = Date.parse(fromIso);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((toMs - then) / 86_400_000);
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
 *   cheapness = (A + B) / 2
 *
 * DRAWDOWN WINDOW CONSISTENCY — this is subtle and was previously wrong.
 * Each historical sample is `max(closes[i-look+1 .. i])` — that is `look`
 * observations *including* closes[i] itself. Today's live price plays exactly
 * the role closes[i] plays, so its window must also be `look` observations
 * including itself: `look - 1` prior closes plus the live price. Using the last
 * `look` closes plus the live price would give today a window of `look + 1`,
 * making today's drawdown systematically deeper than the history it is ranked
 * against, and inflating every dip percentile.
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

  let ddPctile = 50; // no baseline to judge against -> neutral
  if (ddRecent.length >= MIN_DD_HISTORY) {
    const smaller = ddRecent.reduce((acc, d) => acc + (d < ddNow ? 1 : 0), 0);
    ddPctile = (smaller / ddRecent.length) * 100;
  }

  return {
    cheapness: (100 - pricePctile + ddPctile) / 2,
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

// ─── premium over NAV ───────────────────────────────────────────────────────

/**
 * How far the market price sits above the fund's underlying value.
 *
 * Matters for international ETFs: when Indian funds hit the SEBI overseas
 * investment cap they cannot create new units, so the price detaches from NAV.
 * MON100 was measured at a 16% premium — buying it then means paying Rs 1.16
 * for Rs 1.00 of assets.
 */
export function premiumOverNav(
  price: PriceData,
  maxNavAgeDays: number,
  now: number,
): PremiumResult {
  if (price.nav === null || !Number.isFinite(price.nav) || price.nav <= 0) {
    return {
      premiumPct: null,
      nav: null,
      navDate: price.navDate,
      navAgeDays: null,
      unavailable: "no NAV published for this ETF",
    };
  }

  const navAgeDays = price.navDate ? daysBetween(price.navDate, now) : null;
  if (navAgeDays !== null && navAgeDays > maxNavAgeDays) {
    return {
      premiumPct: null,
      nav: price.nav,
      navDate: price.navDate,
      navAgeDays,
      unavailable: `NAV is ${navAgeDays} days old (limit ${maxNavAgeDays})`,
    };
  }

  return {
    premiumPct: ((price.livePrice - price.nav) / price.nav) * 100,
    nav: price.nav,
    navDate: price.navDate,
    navAgeDays,
    unavailable: null,
  };
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
  watchlist: Array<{ symbol: string; name: string; targetPct: number | null }>;
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

  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const targetOf = new Map(watchlist.map((w) => [w.symbol, w.targetPct]));
  const failureOf = new Map(input.priceFailures.map((f) => [f.symbol, f.error]));
  const targetSum = watchlist.reduce((s, w) => s + (w.targetPct ?? 0), 0);

  // ── freshness: what is the newest session we hold data for? ──
  let latestBarMs: number | null = null;
  let newestFetch: number | null = null;
  for (const price of prices.values()) {
    if (price.lastBar) {
      const t = Date.parse(price.lastBar);
      if (Number.isFinite(t) && (latestBarMs === null || t > latestBarMs)) latestBarMs = t;
    }
    const f = Date.parse(price.fetchedAt);
    if (Number.isFinite(f) && (newestFetch === null || f > newestFetch)) newestFetch = f;
  }
  const latestBar = latestBarMs === null ? null : new Date(latestBarMs).toISOString().slice(0, 10);
  const latestBarAgeDays = latestBar === null ? null : daysBetween(latestBar, now);
  const missedSession =
    latestBarAgeDays !== null && latestBarAgeDays > settings.maxBarAgeDays;

  const freshness: Freshness = {
    fetchedAt: newestFetch === null ? null : new Date(newestFetch).toISOString(),
    ageMinutes: newestFetch === null ? null : Math.round((now - newestFetch) / 60_000),
    latestBar,
    latestBarAgeDays,
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

  // ── score the watchlist ──
  const ranked: Candidate[] = [];
  const excluded: Excluded[] = [];
  const minCandles = Math.max(ABSOLUTE_MIN_CANDLES, settings.minCandles);

  for (const { symbol, name, targetPct } of watchlist) {
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

    // 4. premium over NAV
    const premium = premiumOverNav(priceData, settings.maxNavAgeDays, now);
    if (premium.premiumPct !== null && premium.premiumPct > settings.maxPremiumPct) {
      excluded.push({
        symbol,
        name,
        reason:
          `trading ${premium.premiumPct.toFixed(2)}% above NAV Rs.${premium.nav!.toFixed(2)} ` +
          `(limit ${settings.maxPremiumPct}%) — you would be paying well over the underlying value`,
      });
      continue;
    }

    // 5. score
    const todayIso = new Date(now).toISOString().slice(0, 10);
    const score = scoreCheapness(priceData.closes, priceData.livePrice, {
      lastCloseIsToday: priceData.lastBar === todayIso,
    });
    const currentPct = weightOf.get(symbol) ?? 0;
    const gapPct = targetPct === null ? 0 : targetPct - currentPct;
    const cheapnessAdjusted = score.cheapness * score.confidence;
    const gapContribution = settings.gapWeight * gapPct;

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

  // Refuse outright on stale data, before naming anything to buy.
  if (!missedSession) {
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

      const newTotal = total + cost;
      const held = (unitsOf.get(candidate.symbol) ?? 0) * candidate.livePrice;
      const { symbol: _s, name: _n, ...rest } = candidate;

      recommendation = {
        ...rest,
        symbol: candidate.symbol,
        name: candidate.name,
        qty,
        limitPrice,
        cost,
        leftover: Number((settings.budget - cost).toFixed(2)),
        projectedPct: newTotal > 0 ? ((held + cost) / newTotal) * 100 : 0,
      };
      break;
    }
  }

  let blockedReason: string | null = null;
  if (!recommendation) {
    if (missedSession) {
      blockedReason =
        `Refusing to recommend: the newest price data is from ${latestBar} — ` +
        `${latestBarAgeDays} days old, past the ${settings.maxBarAgeDays}-day limit. ` +
        `Prices must be from the latest trading session. Run the fetcher.`;
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
    settings,
    freshness,
    portfolio: { rows, total },
    ranked,
    excluded,
    skipped,
    recommendation,
    blockedReason,
    targetSum,
  };
}
