/**
 * The buying strategy. A direct port of main.py — same constants, same maths,
 * same ordering — so the web app and the local script agree.
 *
 * PIPELINE
 *   1. TREND CHECK      above the 50-day average          -> keep
 *                       below 50-day, above the 14-day     -> keep (turning up)
 *                       below BOTH                         -> discard
 *   2. CHEAPNESS        score the survivors 0-100, cheapest first
 *   3. CONCENTRATION    skip anything already over maxWeightPct of the portfolio
 *   4. BUDGET           skip anything one unit of which busts the budget
 *   5. RECOMMEND        the first candidate that survives all of the above
 *
 * Cheapness is measured against each ETF's OWN history, never against the
 * other ETFs, so a volatile ETF and a steady one are directly comparable.
 * The rupee price level carries no information — scores are scale-invariant.
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
  lastBar: string | null;
  /** When the Action fetched this, ISO string. */
  fetchedAt: string;
};

// ─── constants, mirroring main.py ───────────────────────────────────────────
export const MIN_CANDLES = 100; // below this an ETF cannot be scored
export const PRICE_WINDOW = 252; // trailing sessions for the price percentile
export const HIGH_LOOKBACK = 50; // sessions for the "recent high" in the drawdown
export const MIN_DD_HISTORY = 20; // fewer drawdown samples -> score it neutral
export const TREND_LONG = 50; // first trend test
export const TREND_SHORT = 14; // second chance
export const NSE_TICK = 0.01; // NSE cash-segment tick size

export type TrendBranch = "above-long" | "above-short" | "below-both" | "no-data";

export type TrendResult = {
  keep: boolean;
  branch: TrendBranch;
  /** Short tag for tables, e.g. ">50D". */
  label: string;
  /** Full sentence for the detail line. */
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
};

export type Candidate = {
  symbol: string;
  name: string;
  livePrice: number;
  weight: number;
} & CheapnessResult &
  Pick<TrendResult, "branch" | "label" | "detail" | "dmaLong" | "dmaShort">;

export type Discarded = {
  symbol: string;
  name: string;
  reason: string;
};

export type HoldingRow = {
  symbol: string;
  units: number;
  price: number;
  value: number;
  weight: number;
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
} & Pick<Candidate, "cheapness" | "ddNow" | "ddPctile" | "pricePctile" | "livePrice" | "detail" | "weight">;

export type StrategyResult = {
  generatedAt: string;
  budget: number;
  maxWeightPct: number;
  limitBufferPct: number;
  portfolio: { rows: HoldingRow[]; total: number };
  ranked: Candidate[];
  discarded: Discarded[];
  /** Watchlist symbols that couldn't be scored at all (bad symbol, thin history). */
  unscorable: Discarded[];
  recommendation: Recommendation | null;
  /** Why there's no recommendation, when there isn't one. */
  noPickReason: string | null;
  /** Symbols skipped during the final walk, with the reason. */
  skipped: Array<{ symbol: string; reason: string }>;
};

// ─── helpers ────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Simple moving average of the last `period` values. null if too few. */
function movingAverage(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return mean(closes.slice(-period));
}

/**
 * Your trend rule, in the order you described it.
 *
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

/**
 * Cheapness 0-100, higher = cheaper, scored against this ETF's own history.
 *
 *   A. where the live price sits in its own trailing 1-year range of closes
 *      (0 = at its 52-week low)          -> contributes 100 - percentile
 *   B. today's drawdown from its 50-day high, ranked against its own past
 *      year of drawdowns                 -> contributes that percentile
 *
 *   cheapness = (A + B) / 2
 */
export function scoreCheapness(closes: number[], livePrice: number): CheapnessResult {
  const n = closes.length;
  const window = Math.min(PRICE_WINDOW, n);
  const look = Math.min(HIGH_LOOKBACK, n);

  // ── A. price position in its own trailing range ──
  const recent = closes.slice(-window);
  const below = recent.reduce((acc, c) => acc + (c < livePrice ? 1 : 0), 0);
  const pricePctile = (below / recent.length) * 100;

  // ── B. how unusual is today's dip for this ETF ──
  const lookbackHigh = Math.max(...closes.slice(-look));
  const recentHigh = Math.max(lookbackHigh, livePrice); // live price can be a new high
  const ddNow = recentHigh > 0 ? ((recentHigh - livePrice) / recentHigh) * 100 : 0;

  // Rolling drawdown series from the `look`-day high, matching pandas'
  // rolling(look).max() — the first look-1 entries have no window, so skip them.
  const ddHistory: number[] = [];
  for (let i = look - 1; i < n; i++) {
    const windowHigh = Math.max(...closes.slice(i - look + 1, i + 1));
    if (windowHigh > 0) ddHistory.push(((windowHigh - closes[i]) / windowHigh) * 100);
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
    lastClose: closes[n - 1],
  };
}

/** Units that fit the budget, plus the suggested limit price rounded to tick. */
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

// ─── the whole pipeline ─────────────────────────────────────────────────────

export type StrategyInput = {
  watchlist: Array<{ symbol: string; name: string }>;
  holdings: Array<{ symbol: string; units: number }>;
  budget: number;
  maxWeightPct: number;
  limitBufferPct: number;
  prices: Map<string, PriceData>;
  priceFailures: Array<{ symbol: string; error: string }>;
};

export function runStrategy(input: StrategyInput): StrategyResult {
  const { watchlist, holdings, budget, maxWeightPct, limitBufferPct, prices } = input;

  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const nameOf = new Map(watchlist.map((w) => [w.symbol, w.name]));
  const failureOf = new Map(input.priceFailures.map((f) => [f.symbol, f.error]));

  // ── portfolio table: every held symbol plus unowned watchlist entries ──
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
      onWatchlist: watchSymbols.has(symbol),
      priced: priceData !== undefined,
    };
  });
  for (const row of rows) {
    row.weight = total > 0 ? (row.value / total) * 100 : 0;
  }
  rows.sort((a, b) => b.value - a.value);
  const weightOf = new Map(rows.map((r) => [r.symbol, r.weight]));

  // ── trend check, then cheapness, over the watchlist only ──
  const ranked: Candidate[] = [];
  const discarded: Discarded[] = [];
  const unscorable: Discarded[] = [];

  for (const { symbol, name } of watchlist) {
    const priceData = prices.get(symbol);
    if (!priceData) {
      unscorable.push({
        symbol,
        name,
        reason: failureOf.get(symbol) ?? "no price data returned",
      });
      continue;
    }
    if (priceData.closes.length < MIN_CANDLES) {
      unscorable.push({
        symbol,
        name,
        reason: `only ${priceData.closes.length} daily closes, need ${MIN_CANDLES}`,
      });
      continue;
    }

    const trend = passesTrend(priceData.closes, priceData.livePrice);
    if (!trend.keep) {
      discarded.push({ symbol, name, reason: trend.detail });
      continue;
    }

    const score = scoreCheapness(priceData.closes, priceData.livePrice);
    ranked.push({
      symbol,
      name,
      livePrice: priceData.livePrice,
      weight: weightOf.get(symbol) ?? 0,
      branch: trend.branch,
      label: trend.label,
      detail: trend.detail,
      dmaLong: trend.dmaLong,
      dmaShort: trend.dmaShort,
      ...score,
    });
  }

  ranked.sort((a, b) => b.cheapness - a.cheapness);

  // ── walk the ranking: concentration cap, then budget ──
  const skipped: Array<{ symbol: string; reason: string }> = [];
  let recommendation: Recommendation | null = null;

  for (const candidate of ranked) {
    if (candidate.weight > maxWeightPct) {
      skipped.push({
        symbol: candidate.symbol,
        reason: `already ${candidate.weight.toFixed(1)}% of the portfolio (cap ${maxWeightPct.toFixed(0)}%)`,
      });
      continue;
    }

    const { qty, limitPrice, cost } = sizeOrder(candidate.livePrice, budget, limitBufferPct);
    if (qty < 1) {
      skipped.push({
        symbol: candidate.symbol,
        reason: `one unit costs Rs.${limitPrice.toFixed(2)}, over the Rs.${budget.toFixed(2)} budget`,
      });
      continue;
    }

    recommendation = {
      symbol: candidate.symbol,
      name: candidate.name,
      qty,
      limitPrice,
      cost,
      leftover: Number((budget - cost).toFixed(2)),
      cheapness: candidate.cheapness,
      ddNow: candidate.ddNow,
      ddPctile: candidate.ddPctile,
      pricePctile: candidate.pricePctile,
      livePrice: candidate.livePrice,
      detail: candidate.detail,
      weight: candidate.weight,
    };
    break;
  }

  let noPickReason: string | null = null;
  if (!recommendation) {
    if (watchlist.length === 0) {
      noPickReason = "Your watchlist is empty — add some ETFs first.";
    } else if (ranked.length === 0 && discarded.length > 0) {
      noPickReason =
        `Nothing eligible: every watchlist ETF is under both its ${TREND_LONG}-day and ` +
        `${TREND_SHORT}-day averages. Buy nothing this round.`;
    } else if (ranked.length === 0) {
      noPickReason = "No watchlist ETF could be scored — check the symbols.";
    } else {
      noPickReason =
        `Nothing qualified: every candidate was over the ${maxWeightPct.toFixed(0)}% ` +
        `concentration cap or over the Rs.${budget.toFixed(2)} budget.`;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    budget,
    maxWeightPct,
    limitBufferPct,
    portfolio: { rows, total },
    ranked,
    discarded,
    unscorable,
    recommendation,
    noPickReason,
    skipped,
  };
}
