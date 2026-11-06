import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getAllPrices, pricesFor } from "@/lib/prices";
import { valuePortfolio } from "@/lib/valuation";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { PortfolioView } from "@/components/views/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // All at once — see the Advisor page for why the allowlist check can join in.
  const [allowed, holdings, watchlist, stored] = await Promise.all([
    isAllowed(),
    getHoldings(),
    getWatchlist(),
    getAllPrices(),
  ]);
  if (!allowed) return <NotAllowedNotice />;

  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const { data: prices } = pricesFor(
    stored,
    Array.from(new Set([...holdings.map((h) => h.symbol), ...watchSymbols])),
  );
  const { rows, totals } = valuePortfolio(holdings, prices, watchSymbols);

  return <PortfolioView rows={rows} totals={totals} />;
}
