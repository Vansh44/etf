import { getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { addWatchlistItem, deleteWatchlistItem, updateWatchlistItem } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;
  const items = await getWatchlist();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The ETFs the advisor is allowed to recommend. Use the exact NSE trading symbol — a wrong
          symbol simply won&apos;t be found. Each needs about a year of trading history to be
          scored.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold">Add an ETF</h2>
        <ActionForm
          action={addWatchlistItem}
          resetOnSuccess
          className="mt-3 flex flex-col gap-2 sm:flex-row"
        >
          <input
            name="symbol"
            placeholder="SYMBOL e.g. GOLDBEES"
            required
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case dark:border-slate-700 dark:bg-slate-800 sm:w-56"
          />
          <input
            name="name"
            placeholder="Display name"
            required
            autoComplete="off"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <SubmitButton pendingText="Adding…">Add</SubmitButton>
        </ActionForm>
      </section>

      <section className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {items.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            No ETFs yet. Add one above to get started.
          </p>
        )}

        {items.map((item) => (
          <div key={item.symbol} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <span className="w-32 shrink-0 font-medium">{item.symbol}</span>

            <ActionForm action={updateWatchlistItem} className="flex flex-1 gap-2">
              <input type="hidden" name="symbol" value={item.symbol} />
              <input
                name="name"
                defaultValue={item.name}
                className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <SubmitButton variant="ghost" pendingText="Saving…">
                Save
              </SubmitButton>
            </ActionForm>

            <ActionForm
              action={deleteWatchlistItem}
              confirm={`Remove ${item.symbol} from the watchlist? Your holdings are not affected.`}
            >
              <input type="hidden" name="symbol" value={item.symbol} />
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
