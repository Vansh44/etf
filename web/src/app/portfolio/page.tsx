import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { deleteHolding, upsertHolding } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [holdings, watchlist] = await Promise.all([getHoldings(), getWatchlist()]);
  const onWatchlist = new Set(watchlist.map((w) => w.symbol));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          What you own. List <strong>every</strong> ETF you hold, including ones not on your
          watchlist — they still count toward your portfolio total, and leaving them out would
          overstate every other ETF&apos;s weight.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold">Add or update a holding</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Entering a symbol that already exists overwrites its unit count.
        </p>
        <ActionForm
          action={upsertHolding}
          resetOnSuccess
          className="mt-3 flex flex-col gap-2 sm:flex-row"
        >
          <input
            name="symbol"
            placeholder="SYMBOL e.g. SILVERBEES"
            required
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case dark:border-slate-700 dark:bg-slate-800 sm:w-56"
          />
          <input
            name="units"
            type="number"
            min="0"
            step="1"
            placeholder="Units"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:w-32"
          />
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </ActionForm>
      </section>

      <section className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {holdings.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            No holdings yet. Add one above, or leave this empty if you hold nothing.
          </p>
        )}

        {holdings.map((holding) => (
          <div
            key={holding.symbol}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
          >
            <span className="flex w-48 shrink-0 items-center gap-2">
              <span className="font-medium">{holding.symbol}</span>
              {!onWatchlist.has(holding.symbol) && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  not on watchlist
                </span>
              )}
            </span>

            <ActionForm action={upsertHolding} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="symbol" value={holding.symbol} />
              <input
                name="units"
                type="number"
                min="0"
                step="1"
                defaultValue={holding.units}
                className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">units</span>
              <SubmitButton variant="ghost" pendingText="Saving…">
                Save
              </SubmitButton>
            </ActionForm>

            <ActionForm
              action={deleteHolding}
              confirm={`Remove ${holding.symbol} from your portfolio? This only edits your records — it does not sell anything.`}
            >
              <input type="hidden" name="symbol" value={holding.symbol} />
              <SubmitButton variant="danger" pendingText="Removing…">
                Remove
              </SubmitButton>
            </ActionForm>
          </div>
        ))}
      </section>
    </main>
  );
}
