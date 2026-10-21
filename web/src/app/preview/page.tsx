import { AdvisorEmpty, AdvisorView } from "@/components/views/AdvisorView";
import { parseState, previewAdvisor } from "./fixtures";

export default async function PreviewAdvisor({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const state = parseState((await searchParams).state);
  if (state === "empty") return <AdvisorEmpty base="/preview" />;

  const { result, totals, holdings, prices } = previewAdvisor(state);
  return (
    <AdvisorView
      result={result}
      totals={totals}
      heldUnits={holdings.find((h) => h.symbol === result.recommendation?.symbol)?.units ?? 0}
      hasPrices={prices.size > 0}
      canFetch={false}
      base="/preview"
    />
  );
}
