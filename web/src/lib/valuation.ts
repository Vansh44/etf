import type { PriceData } from "./strategy";

/**
 * Portfolio valuation: what you put in versus what it's worth now.
 *
 * avg_price is optional, so a holding can be worth something while its cost
 * basis is unknown. Those rows contribute to current value but NOT to invested
 * or P&L — otherwise the totals would silently understate what you paid and
 * report a fictional profit.
 */

export type HoldingValuation = {
  symbol: string;
  units: number;
  avgPrice: number | null;
  livePrice: number | null;
  /** units x avgPrice, or null when the cost basis is unknown. */
  invested: number | null;
  /** units x livePrice, or null when there's no price. */
  current: number | null;
  pnl: number | null;
  pnlPct: number | null;
  /** Move since the previous close, from the price history. */
  dayChange: number | null;
  dayChangePct: number | null;
  weight: number;
  onWatchlist: boolean;
};

export type PortfolioTotals = {
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number | null;
  dayChange: number;
  dayChangePct: number | null;
  /** Current value of holdings whose cost basis is unknown — excluded above. */
  currentWithoutBasis: number;
  countWithoutBasis: number;
  /** Holdings with units but no price row. */
  countUnpriced: number;
};

export function valuePortfolio(
  holdings: Array<{ symbol: string; units: number; avgPrice: number | null }>,
  prices: Map<string, PriceData>,
  watchlistSymbols: Set<string>,
): { rows: HoldingValuation[]; totals: PortfolioTotals } {
  const rows: HoldingValuation[] = holdings.map((h) => {
    const price = prices.get(h.symbol);
    const livePrice = price?.livePrice ?? null;

    const invested = h.avgPrice !== null ? h.units * h.avgPrice : null;
    const current = livePrice !== null ? h.units * livePrice : null;

    const pnl = invested !== null && current !== null ? current - invested : null;
    const pnlPct = pnl !== null && invested !== null && invested > 0 ? (pnl / invested) * 100 : null;

    // Previous close is the last daily bar. The live price may already be
    // today's, so this is "since the previous close", not "since open".
    const closes = price?.closes ?? [];
    const prevClose = closes.length > 0 ? closes[closes.length - 1] : null;
    const perUnitMove = livePrice !== null && prevClose !== null ? livePrice - prevClose : null;
    const dayChange = perUnitMove !== null ? perUnitMove * h.units : null;
    const dayChangePct =
      perUnitMove !== null && prevClose !== null && prevClose > 0
        ? (perUnitMove / prevClose) * 100
        : null;

    return {
      symbol: h.symbol,
      units: h.units,
      avgPrice: h.avgPrice,
      livePrice,
      invested,
      current,
      pnl,
      pnlPct,
      dayChange,
      dayChangePct,
      weight: 0,
      onWatchlist: watchlistSymbols.has(h.symbol),
    };
  });

  const currentTotal = rows.reduce((sum, r) => sum + (r.current ?? 0), 0);
  for (const row of rows) {
    row.weight = currentTotal > 0 ? ((row.current ?? 0) / currentTotal) * 100 : 0;
  }
  rows.sort((a, b) => (b.current ?? 0) - (a.current ?? 0));

  // Only rows with a known basis AND a price can contribute to P&L, or the
  // comparison would be between different sets of holdings.
  const comparable = rows.filter((r) => r.invested !== null && r.current !== null);
  const invested = comparable.reduce((s, r) => s + (r.invested as number), 0);
  const currentComparable = comparable.reduce((s, r) => s + (r.current as number), 0);
  const pnl = currentComparable - invested;

  const withoutBasis = rows.filter((r) => r.invested === null && r.current !== null);
  const dayChange = rows.reduce((s, r) => s + (r.dayChange ?? 0), 0);
  const prevTotal = currentTotal - dayChange;

  return {
    rows,
    totals: {
      invested,
      current: currentTotal,
      pnl,
      pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
      dayChange,
      dayChangePct: prevTotal > 0 ? (dayChange / prevTotal) * 100 : null,
      currentWithoutBasis: withoutBasis.reduce((s, r) => s + (r.current as number), 0),
      countWithoutBasis: withoutBasis.length,
      countUnpriced: rows.filter((r) => r.units > 0 && r.current === null).length,
    },
  };
}
