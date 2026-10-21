import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices } from "@/lib/prices";
import { valuePortfolio } from "@/lib/valuation";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { WatchlistView } from "@/components/views/WatchlistView";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [items, holdings] = await Promise.all([getWatchlist(), getHoldings()]);
  const watchSymbols = new Set(items.map((i) => i.symbol));

  // Holdings and prices only to show each ETF's weight beside its target.
  const { data: prices } = await getPrices(holdings.map((h) => h.symbol));
  const { rows } = valuePortfolio(holdings, prices, watchSymbols);

  return <WatchlistView items={items} weights={new Map(rows.map((r) => [r.symbol, r.weight]))} />;
}
