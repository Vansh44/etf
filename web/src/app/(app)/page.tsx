import { getHoldings, getSettings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getAllPrices, pricesFor } from "@/lib/prices";
import { runStrategy } from "@/lib/strategy";
import { valuePortfolio } from "@/lib/valuation";
import { isDispatchConfigured } from "@/lib/github";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { AdvisorEmpty, AdvisorView } from "@/components/views/AdvisorView";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  // One round trip, not three. The allowlist check needn't go first: RLS
  // already hands a refused account zero rows, which are simply discarded.
  const [allowed, watchlist, holdings, settings, stored] = await Promise.all([
    isAllowed(),
    getWatchlist(),
    getHoldings(),
    getSettings(),
    getAllPrices(),
  ]);
  if (!allowed) return <NotAllowedNotice />;

  const symbols = Array.from(
    new Set([...watchlist.map((w) => w.symbol), ...holdings.map((h) => h.symbol)]),
  );
  if (symbols.length === 0) return <AdvisorEmpty />;

  const { data: prices, missing } = pricesFor(stored, symbols);

  const result = runStrategy({
    watchlist,
    holdings: holdings.map((h) => ({ symbol: h.symbol, units: h.units })),
    settings,
    prices,
    priceFailures: missing.map((symbol) => ({ symbol, error: "no price stored yet" })),
  });
  const { totals } = valuePortfolio(holdings, prices, new Set(watchlist.map((w) => w.symbol)));

  return (
    <AdvisorView
      result={result}
      totals={totals}
      heldUnits={holdings.find((h) => h.symbol === result.recommendation?.symbol)?.units ?? 0}
      hasPrices={prices.size > 0}
      canFetch={isDispatchConfigured()}
    />
  );
}
