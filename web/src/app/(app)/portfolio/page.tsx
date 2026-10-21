import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices } from "@/lib/prices";
import { valuePortfolio } from "@/lib/valuation";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { PortfolioView } from "@/components/views/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [holdings, watchlist] = await Promise.all([getHoldings(), getWatchlist()]);
  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const { data: prices } = await getPrices(
    Array.from(new Set([...holdings.map((h) => h.symbol), ...watchSymbols])),
  );
  const { rows, totals } = valuePortfolio(holdings, prices, watchSymbols);

  return <PortfolioView rows={rows} totals={totals} />;
}
