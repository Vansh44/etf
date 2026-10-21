import { PortfolioView } from "@/components/views/PortfolioView";
import { parseState, previewAdvisor } from "../fixtures";

export default async function PreviewPortfolio({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { rows, totals } = previewAdvisor(parseState((await searchParams).state));
  return <PortfolioView rows={rows} totals={totals} />;
}
