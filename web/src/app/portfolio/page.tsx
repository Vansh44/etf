import { getHoldings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices } from "@/lib/prices";
import { valuePortfolio, type HoldingValuation } from "@/lib/valuation";
import { deleteHolding, upsertHolding } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import {
  Card,
  CardHeader,
  Delta,
  EmptyState,
  Pill,
  StatTile,
  rupee,
  rupee0,
  signedRupee,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const input =
  "w-full min-h-11 rounded-xl border px-3 text-sm bg-[var(--surface)] focus:outline-2 focus:outline-offset-1";
const inputStyle = { borderColor: "var(--hairline)", outlineColor: "var(--accent)" };

export default async function PortfolioPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [holdings, watchlist] = await Promise.all([getHoldings(), getWatchlist()]);
  const watchSymbols = new Set(watchlist.map((w) => w.symbol));
  const { data: prices } = await getPrices(
    Array.from(new Set([...holdings.map((h) => h.symbol), ...watchSymbols])),
  );
  const { rows, totals } = valuePortfolio(holdings, prices, watchSymbols);

  const hasBasis = totals.invested > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 pb-16 sm:space-y-5 sm:p-6">
      {/* ── headline value ──────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <p className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
          Current value
        </p>
        <p className="figure mt-1 text-4xl font-semibold sm:text-5xl">
          Rs.{rupee0(totals.current)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Delta value={totals.dayChange} pct={totals.dayChangePct} size="lg" />
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            since previous close
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <StatTile
            label="Invested"
            value={hasBasis ? `Rs.${rupee0(totals.invested)}` : "—"}
            sub={hasBasis ? undefined : "add average buy prices below"}
          />
          <StatTile
            label="Total P&L"
            value={hasBasis ? signedRupee(totals.pnl, { compact: true }) : "—"}
            delta={hasBasis ? <Delta value={totals.pnl} pct={totals.pnlPct} pctOnly /> : undefined}
          />
          <StatTile label="Holdings" value={String(rows.filter((r) => r.units > 0).length)} />
        </div>

        {(totals.countWithoutBasis > 0 || totals.countUnpriced > 0) && (
          <div className="mt-3 space-y-1 text-xs" style={{ color: "var(--ink-2)" }}>
            {totals.countWithoutBasis > 0 && (
              <p>
                {totals.countWithoutBasis} holding
                {totals.countWithoutBasis > 1 ? "s" : ""} worth Rs.
                {rupee0(totals.currentWithoutBasis)} have no average price recorded, so they count
                toward current value but are excluded from Invested and P&amp;L.
              </p>
            )}
            {totals.countUnpriced > 0 && (
              <p>
                {totals.countUnpriced} holding{totals.countUnpriced > 1 ? "s" : ""} have no price
                yet — run the fetcher, or check the symbol is right.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── holdings ────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Your holdings"
          hint="Include every ETF you own, even ones off the watchlist — they count toward your total."
        />

        {rows.length === 0 ? (
          <EmptyState title="No holdings recorded">
            Add one below. Leave this empty if you hold nothing yet.
          </EmptyState>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="rows sm:hidden">
              {rows.map((row) => (
                <li key={row.symbol} className="p-4">
                  <HoldingCard row={row} />
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b text-left text-xs"
                    style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
                  >
                    <th className="px-5 py-2 font-medium">ETF</th>
                    <th className="px-3 py-2 text-right font-medium">Units</th>
                    <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Invested</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-5 py-2 text-right font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.symbol}
                      className="border-b last:border-0"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.symbol}</span>
                          {!row.onWatchlist && <Pill>off watchlist</Pill>}
                        </div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">{row.units}</td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {row.avgPrice !== null ? rupee(row.avgPrice) : "—"}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {row.livePrice !== null ? rupee(row.livePrice) : "—"}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {row.invested !== null ? rupee0(row.invested) : "—"}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-medium">
                        {row.current !== null ? rupee0(row.current) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Delta value={row.pnl} pct={row.pnlPct} />
                      </td>
                      <td className="tnum px-5 py-2.5 text-right" style={{ color: "var(--ink-2)" }}>
                        {row.weight.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* ── add / update ────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Add or update a holding"
          hint="Entering a symbol that already exists overwrites it. Leave average price blank if you don't know it."
        />
        <ActionForm action={upsertHolding} resetOnSuccess className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                NSE symbol
              </span>
              <input
                name="symbol"
                placeholder="SILVERBEES"
                required
                autoComplete="off"
                autoCapitalize="characters"
                className={`${input} uppercase placeholder:normal-case`}
                style={inputStyle}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Units
              </span>
              <input
                name="units"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="0"
                required
                className={`${input} tnum`}
                style={inputStyle}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Avg buy price
              </span>
              <input
                name="avg_price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="optional"
                className={`${input} tnum`}
                style={inputStyle}
              />
            </label>
            <SubmitButton pendingText="Saving…" className="min-h-11 w-full sm:w-auto">
              Save
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {/* ── edit existing rows ──────────────────────────────── */}
      {rows.length > 0 && (
        <Card>
          <CardHeader title="Edit" hint="Change units or average price, or remove a holding." />
          <ul className="rows">
            {rows.map((row) => (
              <li
                key={row.symbol}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5"
              >
                <span className="w-32 shrink-0 font-medium">{row.symbol}</span>
                <ActionForm action={upsertHolding} className="flex flex-1 flex-wrap items-end gap-2">
                  <input type="hidden" name="symbol" value={row.symbol} />
                  <label className="block">
                    <span className="mb-1 block text-xs" style={{ color: "var(--ink-2)" }}>
                      Units
                    </span>
                    <input
                      name="units"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      defaultValue={row.units}
                      className={`${input} tnum w-24`}
                      style={inputStyle}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs" style={{ color: "var(--ink-2)" }}>
                      Avg price
                    </span>
                    <input
                      name="avg_price"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      defaultValue={row.avgPrice ?? ""}
                      placeholder="—"
                      className={`${input} tnum w-28`}
                      style={inputStyle}
                    />
                  </label>
                  <SubmitButton variant="ghost" pendingText="Saving…" className="min-h-11">
                    Save
                  </SubmitButton>
                </ActionForm>
                <ActionForm
                  action={deleteHolding}
                  confirm={`Remove ${row.symbol} from your records? This only edits this app — it does not sell anything.`}
                >
                  <input type="hidden" name="symbol" value={row.symbol} />
                  <SubmitButton variant="danger" pendingText="Removing…" className="min-h-11">
                    Remove
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function HoldingCard({ row }: { row: HoldingValuation }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{row.symbol}</span>
            {!row.onWatchlist && <Pill>off watchlist</Pill>}
          </div>
          <p className="tnum mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            {row.units} units
            {row.avgPrice !== null && <> @ Rs.{rupee(row.avgPrice)} avg</>}
            {row.livePrice !== null && <> · now Rs.{rupee(row.livePrice)}</>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="figure font-semibold">
            {row.current !== null ? `Rs.${rupee0(row.current)}` : "—"}
          </p>
          <p className="tnum text-xs" style={{ color: "var(--ink-2)" }}>
            {row.weight.toFixed(1)}%
          </p>
        </div>
      </div>
      <div className="mt-2">
        <Delta value={row.pnl} pct={row.pnlPct} />
      </div>
    </>
  );
}
