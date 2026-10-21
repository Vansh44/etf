import { addWatchlistItem, deleteWatchlistItem, updateWatchlistItem } from "@/app/actions";
import type { WatchlistItem } from "@/lib/data";
import { Page } from "@/components/AppShell";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Card, CardHeader, EmptyState, Eyebrow, Pill, WeightBar, inputClass } from "@/components/ui";

/**
 * The Watchlist screen: the ETFs the advisor may buy, the share of the
 * portfolio each should be, and how far each is from it today.
 */

export type WatchlistData = {
  items: WatchlistItem[];
  /** Current share of the whole portfolio, by symbol. Missing = not held. */
  weights: Map<string, number>;
};

export function WatchlistView({ items, weights }: WatchlistData) {
  const targetSum = items.reduce((sum, i) => sum + (i.targetPct ?? 0), 0);
  const anyTargets = items.some((i) => i.targetPct !== null);
  // One scale for every bar, so their lengths compare across rows.
  const scaleMax = Math.max(
    1,
    ...items.map((i) => Math.max(i.targetPct ?? 0, weights.get(i.symbol) ?? 0)),
  );

  return (
    <Page width="narrow">
      <TargetMix sum={targetSum} anyTargets={anyTargets} count={items.length} />

      <Card className="overflow-hidden">
        <CardHeader
          title="Watchlist"
          count={items.length}
          hint="The ETFs the advisor may recommend. The bar is each one's share of your portfolio now; the tick is its target. Tap one to edit."
        />
        {items.length === 0 ? (
          <EmptyState title="No ETFs yet">Add one below to get started.</EmptyState>
        ) : (
          <div className="rows">
            {items.map((item) => (
              <WatchRow key={item.symbol} item={item} weight={weights.get(item.symbol) ?? 0} scaleMax={scaleMax} />
            ))}
          </div>
        )}
      </Card>

      <AddEtf />
    </Page>
  );
}

function TargetMix({ sum, anyTargets, count }: { sum: number; anyTargets: boolean; count: number }) {
  const onTarget = Math.abs(sum - 100) < 0.5;
  const over = sum > 100.5;
  return (
    <Card>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Target mix</Eyebrow>
            <p className="figure mt-1.5 text-3xl font-semibold">
              {anyTargets ? `${sum.toFixed(sum % 1 === 0 ? 0 : 1)}%` : "—"}
              <span className="ml-1.5 text-sm font-normal text-ink-2">assigned across {count} ETFs</span>
            </p>
          </div>
          {anyTargets && (
            <Pill tone={onTarget ? "gain" : over ? "loss" : "warn"}>
              {onTarget ? "Adds up" : over ? `${(sum - 100).toFixed(1)}% over` : `${(100 - sum).toFixed(1)}% to go`}
            </Pill>
          )}
        </div>
        {anyTargets && (
          <div
            className="mt-3.5 h-2 overflow-hidden rounded-full bg-meter-track"
            role="img"
            aria-label={`Targets add up to ${sum.toFixed(1)} percent of 100`}
          >
            <div
              className={`h-full rounded-full ${over ? "bg-loss" : "bg-meter-fill"}`}
              style={{ width: `${Math.min(100, sum)}%` }}
            />
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-2">
          {anyTargets
            ? "Targets should add up to 100%. More than 1% off and the Advisor warns you; more than 5% off and it stops recommending until you fix them."
            : "No targets set, so every ETF counts as on target and the pick comes down to cheapness alone."}
        </p>
      </div>
    </Card>
  );
}

function WatchRow({ item, weight, scaleMax }: { item: WatchlistItem; weight: number; scaleMax: number }) {
  const gap = item.targetPct === null ? null : item.targetPct - weight;
  return (
    <details>
      <summary className="px-4 py-3.5 transition hover:bg-surface-2/60 active:bg-surface-2 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{item.symbol}</span>
              {item.premiumSensitive && <Pill tone="accent">Far from NAV</Pill>}
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-2">{item.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="figure text-lg font-semibold">
              {item.targetPct === null ? <span className="text-ink-2">—</span> : `${item.targetPct}%`}
            </p>
            <p className="tnum text-[11px] text-ink-2">now {weight.toFixed(1)}%</p>
          </div>
          <ChevronRightIcon className="chevron h-4 w-4 shrink-0 text-ink-2" />
        </div>
        <div className="mt-3 flex items-center gap-3 pr-7">
          <div className="flex-1">
            <WeightBar
              current={weight}
              target={item.targetPct}
              scaleMax={scaleMax}
              label={
                item.targetPct === null
                  ? `${item.symbol} is ${weight.toFixed(1)}% of the portfolio, no target`
                  : `${item.symbol} is ${weight.toFixed(1)}% of the portfolio against a ${item.targetPct}% target`
              }
            />
          </div>
          <span
            className={`tnum w-16 shrink-0 text-right text-[11px] font-semibold ${
              gap === null ? "text-ink-2" : gap > 0.05 ? "text-gain" : gap < -0.05 ? "text-loss" : "text-ink-2"
            }`}
          >
            {gap === null ? "no target" : `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}pp`}
          </span>
        </div>
      </summary>

      <div className="border-t border-hairline bg-surface-2/60 px-4 py-4 sm:px-5">
        <ActionForm action={updateWatchlistItem} collapseOnSuccess className="space-y-3">
          <input type="hidden" name="symbol" value={item.symbol} />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-2">Display name</span>
              <input
                name="name"
                defaultValue={item.name}
                aria-label={`Display name for ${item.symbol}`}
                className={`${inputClass} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-2">Target %</span>
              <input
                name="target_pct"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.5"
                defaultValue={item.targetPct ?? ""}
                placeholder="none"
                aria-label={`Target percent for ${item.symbol}`}
                className={`${inputClass} tnum w-full`}
              />
            </label>
          </div>
          <FarFromNavToggle defaultChecked={item.premiumSensitive} symbol={item.symbol} />
          <SubmitButton pendingText="Saving…" className="w-full sm:w-auto">
            Save
          </SubmitButton>
        </ActionForm>
        <ActionForm
          action={deleteWatchlistItem}
          confirm={`Remove ${item.symbol} from the watchlist? Your holdings are not affected.`}
          className="mt-2"
        >
          <input type="hidden" name="symbol" value={item.symbol} />
          <SubmitButton variant="danger" size="sm" pendingText="Removing…">
            Remove from watchlist
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

/** A checkbox styled as a switch: still a real checkbox, so the form posts "on". */
function FarFromNavToggle({ defaultChecked = false, symbol }: { defaultChecked?: boolean; symbol?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-surface px-3.5 py-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          name="premium_sensitive"
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-label={symbol ? `${symbol} can trade far from NAV` : "Can trade far from NAV"}
          className="peer sr-only"
        />
        <span className="h-6 w-10 rounded-full bg-hairline-strong transition peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">Can trade far from NAV</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">
          For international or thinly traded ETFs. If there&apos;s no NAV to check its premium against, it&apos;s
          skipped instead of given the benefit of the doubt.
        </span>
      </span>
    </label>
  );
}

function AddEtf() {
  return (
    <Card className="overflow-hidden">
      <details>
        <summary className="flex min-h-14 items-center gap-3 px-4 text-[15px] font-semibold text-accent transition hover:bg-accent-soft sm:px-5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft">
            <PlusIcon className="h-[18px] w-[18px]" />
          </span>
          Add an ETF
          <ChevronRightIcon className="chevron ml-auto h-4 w-4 text-ink-2" />
        </summary>
        <div className="border-t border-hairline px-4 py-4 sm:px-5">
          <p className="mb-3 text-xs leading-relaxed text-ink-2">
            Use the exact NSE symbol. Leave the target blank and the ETF counts as exactly on target.
          </p>
          <ActionForm action={addWatchlistItem} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_7rem]">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-2">NSE symbol</span>
                <input
                  name="symbol"
                  placeholder="GOLDBEES"
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  className={`${inputClass} w-full uppercase placeholder:normal-case`}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-2">Display name</span>
                <input
                  name="name"
                  placeholder="Nippon India ETF Gold BeES"
                  required
                  autoComplete="off"
                  className={`${inputClass} w-full`}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-2">Target %</span>
                <input
                  name="target_pct"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder="optional"
                  className={`${inputClass} tnum w-full`}
                />
              </label>
            </div>
            <FarFromNavToggle />
            <SubmitButton pendingText="Adding…" className="w-full sm:w-auto">
              Add to watchlist
            </SubmitButton>
          </ActionForm>
        </div>
      </details>
    </Card>
  );
}
