import { getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { addWatchlistItem, deleteWatchlistItem, updateWatchlistItem } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const input =
  "w-full min-h-11 rounded-xl border px-3 text-sm bg-[var(--surface)] focus:outline-2 focus:outline-offset-1";
const inputStyle = { borderColor: "var(--hairline)", outlineColor: "var(--accent)" };

export default async function WatchlistPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;
  const items = await getWatchlist();
  const targetSum = items.reduce((sum, i) => sum + (i.targetPct ?? 0), 0);
  const anyTargets = items.some((i) => i.targetPct !== null);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-3 pb-16 sm:space-y-5 sm:p-6">
      <Card>
        <CardHeader
          title="Watchlist"
          hint="The ETFs the advisor may recommend, and the share of your portfolio you want each to be. Use exact NSE symbols. Leave a target blank to score that ETF on cheapness alone."
        />
        <ActionForm action={addWatchlistItem} resetOnSuccess className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr_7rem_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                NSE symbol
              </span>
              <input
                name="symbol"
                placeholder="GOLDBEES"
                required
                autoComplete="off"
                autoCapitalize="characters"
                className={`${input} uppercase placeholder:normal-case`}
                style={inputStyle}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Display name
              </span>
              <input
                name="name"
                placeholder="Nippon India ETF Gold BeES"
                required
                autoComplete="off"
                className={input}
                style={inputStyle}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Target %
              </span>
              <input
                name="target_pct"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.5"
                placeholder="optional"
                className={`${input} tnum`}
                style={inputStyle}
              />
            </label>
            <SubmitButton pendingText="Adding…" className="min-h-11 w-full sm:w-auto">
              Add
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader
          title={`${items.length} ETF${items.length === 1 ? "" : "s"} in the pool`}
          right={
            anyTargets ? (
              <Pill tone={Math.abs(targetSum - 100) < 0.5 ? "gain" : "loss"}>
                targets total {targetSum.toFixed(1)}%
              </Pill>
            ) : undefined
          }
        />
        {items.length === 0 ? (
          <EmptyState title="No ETFs yet">Add one above to get started.</EmptyState>
        ) : (
          <ul className="rows">
            {items.map((item) => (
              <li key={item.symbol} className="p-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <span className="w-32 shrink-0 font-medium">{item.symbol}</span>

                  <ActionForm
                    action={updateWatchlistItem}
                    className="flex flex-1 items-center gap-2"
                  >
                    <input type="hidden" name="symbol" value={item.symbol} />
                    <input
                      name="name"
                      defaultValue={item.name}
                      aria-label={`Display name for ${item.symbol}`}
                      className={input}
                      style={inputStyle}
                    />
                    <input
                      name="target_pct"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.5"
                      defaultValue={item.targetPct ?? ""}
                      placeholder="—"
                      aria-label={`Target percent for ${item.symbol}`}
                      className={`${input} tnum w-20 shrink-0`}
                      style={inputStyle}
                    />
                    <SubmitButton variant="ghost" pendingText="…" className="min-h-11 shrink-0">
                      Save
                    </SubmitButton>
                  </ActionForm>

                  <ActionForm
                    action={deleteWatchlistItem}
                    confirm={`Remove ${item.symbol} from the watchlist? Your holdings are not affected.`}
                  >
                    <input type="hidden" name="symbol" value={item.symbol} />
                    <SubmitButton variant="danger" pendingText="…" className="min-h-11">
                      Remove
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
