import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getAllPrices, pricesFor } from "@/lib/prices";
import { valuePortfolio } from "@/lib/valuation";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { WatchlistView } from "@/components/views/WatchlistView";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  // All at once — see the Advisor page for why the allowlist check can join in.
  const [allowed, items, holdings, stored] = await Promise.all([
    isAllowed(),
    getWatchlist(),
    getHoldings(),
    getAllPrices(),
  ]);
  if (!allowed) return <NotAllowedNotice />;

  const watchSymbols = new Set(items.map((i) => i.symbol));

  // Holdings and prices only to show each ETF's weight beside its target.
  const { data: prices } = pricesFor(stored, holdings.map((h) => h.symbol));
  const { rows } = valuePortfolio(holdings, prices, watchSymbols);

  return <WatchlistView items={items} weights={new Map(rows.map((r) => [r.symbol, r.weight]))} />;
}
