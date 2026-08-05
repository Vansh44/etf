import Link from "next/link";
import { getHoldings, getSettings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices, STALE_AFTER_MINUTES } from "@/lib/prices";
import { runStrategy, TREND_LONG, TREND_SHORT } from "@/lib/strategy";
import { valuePortfolio } from "@/lib/valuation";
import { isDispatchConfigured } from "@/lib/github";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { RunButton } from "@/components/RunButton";
import {
  Card,
  CardHeader,
  DefRow,
  Delta,
  EmptyState,
  Meter,
  Pill,
  StatTile,
  compact,
  rupee,
  rupee0,
  signedRupee,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [watchlist, holdings, settings] = await Promise.all([
    getWatchlist(),
    getHoldings(),
    getSettings(),
  ]);

  const symbols = Array.from(
    new Set([...watchlist.map((w) => w.symbol), ...holdings.map((h) => h.symbol)]),
  );

  if (symbols.length === 0) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <Card>
          <EmptyState title="Nothing to work with yet">
            Add the ETFs you want to buy on the{" "}
            <Link href="/watchlist" className="underline">
              Watchlist
            </Link>{" "}
            page, and what you already own on the{" "}
            <Link href="/portfolio" className="underline">
              Portfolio
            </Link>{" "}
            page.
          </EmptyState>
        </Card>
      </main>
    );
  }

  const { data: prices, missing, fetchedAt, ageMinutes, isStale } = await getPrices(symbols);

  const result = runStrategy({
    watchlist,
    holdings: holdings.map((h) => ({ symbol: h.symbol, units: h.units })),
    budget: settings.budget,
    maxWeightPct: settings.maxWeightPct,
    limitBufferPct: settings.limitBufferPct,
    prices,
    priceFailures: missing.map((symbol) => ({ symbol, error: "no price stored yet" })),
  });

  const { totals } = valuePortfolio(holdings, prices, new Set(watchlist.map((w) => w.symbol)));

  const { recommendation: pick, ranked, discarded, unscorable, skipped } = result;
  const heldUnits = holdings.find((h) => h.symbol === pick?.symbol)?.units ?? 0;
  const noPrices = fetchedAt === null;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 pb-16 sm:space-y-5 sm:p-6">
      {/* ── run control ─────────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold sm:text-xl">Which ETF should I buy?</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
              Budget Rs.{rupee0(settings.budget)} · cap {settings.maxWeightPct.toFixed(0)}% per ETF
              {fetchedAt && (
                <>
                  {" · "}
                  prices {ageMinutes === 0 ? "just now" : `${ageMinutes}m old`}
                </>
              )}
            </p>
          </div>
          <div className="sm:shrink-0">
            <RunButton hasPrices={!noPrices} />
          </div>
        </div>
        {!isDispatchConfigured() && (
          <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
            Tip: set <code>GITHUB_TOKEN</code> and <code>GITHUB_REPO</code> in Vercel and this
            button will fetch fresh prices too, not just re-score the stored ones.
          </p>
        )}
      </Card>

      {/* ── data warnings ───────────────────────────────────── */}
      {noPrices && (
        <Card className="p-4" as="div">
          <p className="text-sm font-semibold" style={{ color: "var(--loss)" }}>
            No price data yet
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            Press the button above, or run the <strong>Fetch ETF prices</strong> workflow in GitHub
            Actions once. Nothing can be scored until prices exist.
          </p>
        </Card>
      )}

      {isStale && !noPrices && (
        <Card className="p-4" as="div">
          <p className="text-sm">
            <strong style={{ color: "var(--loss)" }}>Prices are {ageMinutes} minutes old</strong> —
            older than {STALE_AFTER_MINUTES} min. Press the button to refresh, or check the GitHub
            Action.
          </p>
        </Card>
      )}

      {/* ── the recommendation ──────────────────────────────── */}
      {pick ? (
        <Card
          className="overflow-hidden"
          // A tinted rail rather than a full colour wash, so the value stays the
          // loudest thing in the card.
        >
          <div className="flex" style={{ background: "var(--gain-soft)" }}>
            <div className="w-1 shrink-0" style={{ background: "var(--gain)" }} aria-hidden="true" />
            <div className="min-w-0 flex-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="gain">Buy</Pill>
                <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                  cheapest of {ranked.length} eligible
                </span>
              </div>

              <h2 className="figure mt-2 text-2xl font-semibold sm:text-3xl">{pick.symbol}</h2>
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                {pick.name}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                <StatTile label="Units to buy" value={String(pick.qty)} hero />
                <StatTile label="Limit price" value={`Rs.${rupee(pick.limitPrice)}`} />
                <StatTile
                  label="Total cost"
                  value={`Rs.${rupee0(pick.cost)}`}
                  sub={`Rs.${rupee(pick.leftover)} unspent`}
                />
              </div>

              <dl className="mt-4">
                <DefRow
                  k="Cheapness"
                  v={
                    <span>
                      <strong>{pick.cheapness.toFixed(1)}/100</strong> — {pick.ddNow.toFixed(1)}%
                      off its {TREND_LONG}-day high, a deeper dip than{" "}
                      {pick.ddPctile.toFixed(0)}% of its own
                    </span>
                  }
                />
                <DefRow k="Trend" v={pick.detail} />
                <DefRow
                  k="Position"
                  v={`${pick.weight.toFixed(1)}% of your portfolio (cap ${settings.maxWeightPct.toFixed(0)}%)`}
                />
                <DefRow
                  k="Live price"
                  v={`Rs.${rupee(pick.livePrice)} — limit set +${settings.limitBufferPct.toFixed(2)}% above`}
                />
              </dl>

              <p
                className="mt-4 rounded-xl border p-3 text-sm"
                style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
              >
                Place this yourself in Groww — check the live price there first. Once it fills, set{" "}
                {pick.symbol} to <strong>{heldUnits + pick.qty}</strong> units on the{" "}
                <Link href="/portfolio" className="underline">
                  Portfolio
                </Link>{" "}
                page.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        !noPrices && (
          <Card className="p-4 sm:p-5" as="div">
            <Pill tone="loss">No buy</Pill>
            <p className="mt-2 text-sm">{result.noPickReason}</p>
          </Card>
        )
      )}

      {/* ── portfolio summary (full detail lives on /portfolio) ── */}
      {totals.current > 0 && (
        <Card>
          <CardHeader
            title="Portfolio"
            right={
              <Link href="/portfolio" className="text-xs underline" style={{ color: "var(--ink-2)" }}>
                Manage
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 sm:gap-3 sm:p-5">
            <StatTile label="Current value" value={`Rs.${compact(totals.current)}`} />
            <StatTile
              label="Invested"
              value={totals.invested > 0 ? `Rs.${compact(totals.invested)}` : "—"}
            />
            <StatTile
              label="Total P&L"
              value={totals.invested > 0 ? signedRupee(totals.pnl, { compact: true }) : "—"}
              delta={totals.invested > 0 ? <Delta value={totals.pnl} pct={totals.pnlPct} pctOnly /> : undefined}
            />
            <StatTile
              label="Since prev close"
              value={signedRupee(totals.dayChange, { compact: true })}
              delta={<Delta value={totals.dayChange} pct={totals.dayChangePct} pctOnly />}
            />
          </div>
        </Card>
      )}

      {/* ── cheapness ranking ───────────────────────────────── */}
      {ranked.length > 0 && (
        <Card>
          <CardHeader
            title="Cheapness ranking"
            hint="Each ETF scored against its own history — higher is cheaper. The rupee price level is irrelevant."
          />

          {/* Mobile: one card per ETF. Desktop: a table. */}
          <ul className="divide-y sm:hidden" style={{ borderColor: "var(--hairline)" }}>
            {ranked.map((r, i) => {
              const skip = skipped.find((s) => s.symbol === r.symbol);
              return (
                <li key={r.symbol} className="flex items-start gap-3 p-4">
                  <span className="tnum w-5 shrink-0 text-sm" style={{ color: "var(--ink-2)" }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.symbol}</span>
                      {pick?.symbol === r.symbol && <Pill tone="gain">picked</Pill>}
                      <Pill>{r.label}</Pill>
                    </div>
                    <div className="mt-2">
                      <Meter value={r.cheapness} label={`Cheapness ${r.cheapness.toFixed(1)} of 100`} />
                    </div>
                    <p className="tnum mt-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
                      {r.pricePctile.toFixed(0)}% up its 1-yr range · dip {r.ddNow.toFixed(1)}% ·
                      deeper than {r.ddPctile.toFixed(0)}% of its own
                    </p>
                    {skip && (
                      <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                        Skipped: {skip.reason}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
                >
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">ETF</th>
                  <th className="px-3 py-2 font-medium">Cheapness</th>
                  <th className="px-3 py-2 text-right font-medium">In own range</th>
                  <th className="px-3 py-2 text-right font-medium">Dip now</th>
                  <th className="px-3 py-2 text-right font-medium">Dip vs own</th>
                  <th className="px-5 py-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const skip = skipped.find((s) => s.symbol === r.symbol);
                  return (
                    <tr key={r.symbol} className="border-b last:border-0" style={{ borderColor: "var(--hairline)" }}>
                      <td className="tnum px-5 py-2.5" style={{ color: "var(--ink-2)" }}>
                        {i + 1}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.symbol}</span>
                          {pick?.symbol === r.symbol && <Pill tone="gain">picked</Pill>}
                        </div>
                        {skip && (
                          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                            {skip.reason}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Meter value={r.cheapness} label={`Cheapness ${r.cheapness.toFixed(1)} of 100`} />
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">{r.pricePctile.toFixed(0)}%</td>
                      <td className="tnum px-3 py-2.5 text-right">{r.ddNow.toFixed(1)}%</td>
                      <td className="tnum px-3 py-2.5 text-right">{r.ddPctile.toFixed(0)}%</td>
                      <td className="px-5 py-2.5 text-right">
                        <Pill>{r.label}</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── discarded + unscorable ──────────────────────────── */}
      {(discarded.length > 0 || unscorable.length > 0) && (
        <Card>
          <CardHeader
            title="Not in the running"
            hint={`Under both the ${TREND_LONG}-day and ${TREND_SHORT}-day averages, or missing data.`}
          />
          <ul className="divide-y" style={{ borderColor: "var(--hairline)" }}>
            {discarded.map((d) => (
              <li key={d.symbol} className="px-4 py-3 sm:px-5">
                <span className="text-sm font-medium">{d.symbol}</span>
                <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                  {d.reason}
                </p>
              </li>
            ))}
            {unscorable.map((u) => (
              <li key={u.symbol} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{u.symbol}</span>
                  <Pill tone="loss">not scored</Pill>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                  {u.reason}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="px-1 text-xs" style={{ color: "var(--ink-2)" }}>
        Prices from Yahoo Finance via the scheduled fetcher
        {fetchedAt && <> · last updated {new Date(fetchedAt).toLocaleString("en-IN")}</>}. This tool
        reports numbers, places no orders, and is not financial advice.
      </p>
    </main>
  );
}
