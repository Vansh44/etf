import { deleteHolding, upsertHolding } from "@/app/actions";
import type { HoldingValuation, PortfolioTotals } from "@/lib/valuation";
import { Page } from "@/components/AppShell";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import {
  Card,
  CardHeader,
  Delta,
  EmptyState,
  Eyebrow,
  Pill,
  Stat,
  inputClass,
  rupee,
  rupee0,
  signedPct,
  signedRupee,
} from "@/components/ui";

/**
 * The Portfolio screen: a big current-value headline, then holdings as dense
 * rows that open into their own edit form. Pure presentation — see
 * AdvisorView for why.
 */

export type PortfolioData = {
  rows: HoldingValuation[];
  totals: PortfolioTotals;
};

const TABLE_COLUMNS =
  "lg:grid-cols-[minmax(0,1.4fr)_4rem_5.5rem_5.5rem_6.5rem_6.5rem_7.5rem_6rem_1.25rem]";

export function PortfolioView({ rows, totals }: PortfolioData) {
  const hasBasis = totals.invested > 0;
  const held = rows.filter((r) => r.units > 0).length;

  return (
    <Page>
      <Card>
        <div className="p-4 sm:p-6">
          <Eyebrow>Current value</Eyebrow>
          <p className="figure mt-1.5 text-[40px] font-semibold leading-none sm:text-5xl">
            ₹{rupee0(totals.current)}
          </p>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <Delta value={totals.dayChange} pct={totals.dayChangePct} />
            <span className="text-xs text-ink-2">today</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
            <Stat label="Invested" value={hasBasis ? `₹${rupee0(totals.invested)}` : "—"} />
            <Stat
              label="Total returns"
              value={
                hasBasis ? (
                  <span className={totals.pnl >= 0 ? "text-gain" : "text-loss"}>{signedRupee(totals.pnl)}</span>
                ) : (
                  "—"
                )
              }
              sub={hasBasis && totals.pnlPct !== null ? signedPct(totals.pnlPct) : "add average buy prices"}
            />
            <Stat label="Holdings" value={String(held)} className="hidden sm:block" />
          </div>

          {(totals.countWithoutBasis > 0 || totals.countUnpriced > 0) && (
            <div className="mt-4 space-y-1 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
              {totals.countWithoutBasis > 0 && (
                <p>
                  {totals.countWithoutBasis} holding{totals.countWithoutBasis > 1 ? "s" : ""} worth ₹
                  {rupee0(totals.currentWithoutBasis)} {totals.countWithoutBasis > 1 ? "have" : "has"} no average
                  price, so {totals.countWithoutBasis > 1 ? "they count" : "it counts"} toward current value but not
                  Invested or returns.
                </p>
              )}
              {totals.countUnpriced > 0 && (
                <p>
                  {totals.countUnpriced} holding{totals.countUnpriced > 1 ? "s have" : " has"} no price yet — run the
                  fetcher, or check the symbol.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Holdings"
          count={held}
          hint="Include every ETF you own, even ones off the watchlist — they count toward your weights. Tap one to edit."
        />

        {rows.length === 0 ? (
          <EmptyState title="No holdings recorded">Add one below. Leave this empty if you hold nothing yet.</EmptyState>
        ) : (
          <>
            <div
              className={`hidden gap-4 border-b border-hairline px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2 lg:grid ${TABLE_COLUMNS}`}
            >
              <span>Instrument</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Avg</span>
              <span className="text-right">LTP</span>
              <span className="text-right">Invested</span>
              <span className="text-right">Current</span>
              <span className="text-right">P&amp;L</span>
              <span className="text-right">Day</span>
              <span />
            </div>
            <div className="rows">
              {rows.map((row) => (
                <HoldingRow key={row.symbol} row={row} />
              ))}
            </div>
          </>
        )}
      </Card>

      <AddHolding />
    </Page>
  );
}

function HoldingRow({ row }: { row: HoldingValuation }) {
  const pnlTone = row.pnl === null ? "text-ink-2" : row.pnl >= 0 ? "text-gain" : "text-loss";

  return (
    <details>
      <summary className="px-4 py-3.5 transition hover:bg-surface-2/60 active:bg-surface-2 sm:px-5">
        {/* phone and tablet: the three-line broker row */}
        <div className="lg:hidden">
          <div className="flex items-baseline justify-between gap-3 text-xs text-ink-2">
            <span className="tnum">
              Qty {row.units}
              {row.avgPrice !== null && <> · Avg {rupee(row.avgPrice)}</>}
            </span>
            <span className={`tnum font-semibold ${pnlTone}`}>
              {row.pnlPct === null ? "—" : signedPct(row.pnlPct)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{row.symbol}</span>
              {!row.onWatchlist && <Pill>Off watchlist</Pill>}
            </span>
            <span className={`tnum shrink-0 text-[15px] font-semibold ${pnlTone}`}>
              {row.pnl === null ? "—" : signedRupee(row.pnl, { dp: 2 })}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-ink-2">
            <span className="tnum">
              {row.current !== null ? `₹${rupee0(row.current)}` : "No price"} · {row.weight.toFixed(1)}%
            </span>
            <span className="tnum">
              {row.livePrice !== null ? <>LTP {rupee(row.livePrice)} </> : "—"}
              {row.dayChangePct !== null && (
                <span className={row.dayChangePct >= 0 ? "text-gain" : "text-loss"}>
                  ({signedPct(row.dayChangePct)})
                </span>
              )}
            </span>
          </div>
        </div>

        {/* desktop: one line per holding, like a broker's table */}
        <div className={`hidden items-center gap-4 text-sm lg:grid ${TABLE_COLUMNS}`}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{row.symbol}</span>
            {!row.onWatchlist && <Pill>Off watchlist</Pill>}
          </span>
          <span className="tnum text-right">{row.units}</span>
          <span className="tnum text-right">{row.avgPrice !== null ? rupee(row.avgPrice) : "—"}</span>
          <span className="tnum text-right">{row.livePrice !== null ? rupee(row.livePrice) : "—"}</span>
          <span className="tnum text-right">{row.invested !== null ? rupee0(row.invested) : "—"}</span>
          <span className="tnum text-right font-medium">{row.current !== null ? rupee0(row.current) : "—"}</span>
          <span className={`tnum text-right font-medium ${pnlTone}`}>
            {row.pnl === null ? "—" : signedRupee(row.pnl)}
            {row.pnlPct !== null && <span className="block text-xs font-normal">{signedPct(row.pnlPct)}</span>}
          </span>
          <span
            className={`tnum text-right ${
              row.dayChangePct === null ? "text-ink-2" : row.dayChangePct >= 0 ? "text-gain" : "text-loss"
            }`}
          >
            {row.dayChangePct === null ? "—" : signedPct(row.dayChangePct)}
          </span>
          <ChevronRightIcon className="chevron h-4 w-4 text-ink-2" />
        </div>
      </summary>

      <div className="border-t border-hairline bg-surface-2/60 px-4 py-4 sm:px-5">
        <ActionForm
          action={upsertHolding}
          collapseOnSuccess
          className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_10rem_auto] sm:items-end"
        >
          <input type="hidden" name="symbol" value={row.symbol} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Units</span>
            <input
              name="units"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              defaultValue={row.units}
              aria-label={`Units of ${row.symbol}`}
              className={`${inputClass} tnum w-full`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Avg buy price</span>
            <input
              name="avg_price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              defaultValue={row.avgPrice ?? ""}
              placeholder="unknown"
              aria-label={`Average price of ${row.symbol}`}
              className={`${inputClass} tnum w-full`}
            />
          </label>
          <SubmitButton pendingText="Saving…" className="col-span-2 w-full sm:col-span-1 sm:w-auto">
            Save
          </SubmitButton>
        </ActionForm>
        <ActionForm
          action={deleteHolding}
          confirm={`Remove ${row.symbol} from your records? This only edits this app — it does not sell anything.`}
          className="mt-2"
        >
          <input type="hidden" name="symbol" value={row.symbol} />
          <SubmitButton variant="danger" size="sm" pendingText="Removing…">
            Remove {row.symbol}
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

function AddHolding() {
  return (
    <Card className="overflow-hidden">
      <details>
        <summary className="flex min-h-14 items-center gap-3 px-4 text-[15px] font-semibold text-accent transition hover:bg-accent-soft sm:px-5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft">
            <PlusIcon className="h-[18px] w-[18px]" />
          </span>
          Add or update a holding
          <ChevronRightIcon className="chevron ml-auto h-4 w-4 text-ink-2" />
        </summary>
        <div className="border-t border-hairline px-4 py-4 sm:px-5">
          <p className="mb-3 text-xs leading-relaxed text-ink-2">
            Entering a symbol you already hold overwrites it. Leave the average price blank if you don&apos;t know
            it.
          </p>
          <ActionForm
            action={upsertHolding}
            resetOnSuccess
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto] sm:items-end"
          >
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-2">NSE symbol</span>
              <input
                name="symbol"
                placeholder="SILVERBEES"
                required
                autoComplete="off"
                autoCapitalize="characters"
                className={`${inputClass} w-full uppercase placeholder:normal-case`}
              />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:contents">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-2">Units</span>
                <input
                  name="units"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  required
                  className={`${inputClass} tnum w-full`}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-2">Avg buy price</span>
                <input
                  name="avg_price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="optional"
                  className={`${inputClass} tnum w-full`}
                />
              </label>
            </div>
            <SubmitButton pendingText="Saving…" className="w-full sm:w-auto">
              Save holding
            </SubmitButton>
          </ActionForm>
        </div>
      </details>
    </Card>
  );
}
