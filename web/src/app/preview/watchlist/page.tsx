import { WatchlistView } from "@/components/views/WatchlistView";
import { parseState, previewAdvisor } from "../fixtures";

export default async function PreviewWatchlist({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { watchlist, rows } = previewAdvisor(parseState((await searchParams).state));
  return <WatchlistView items={watchlist} weights={new Map(rows.map((r) => [r.symbol, r.weight]))} />;
}
