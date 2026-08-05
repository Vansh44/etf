import Link from "next/link";
import { getHoldings, getSettings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices } from "@/lib/prices";
import { runStrategy, PRICE_WINDOW, TREND_LONG, TREND_SHORT } from "@/lib/strategy";
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
  Pill,
  StatTile,
  compact,
  rupee,
  rupee0,
  signedRupee,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const signedPts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

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

  const { data: prices, missing } = await getPrices(symbols);

  const result = runStrategy({
    watchlist,
    holdings: holdings.map((h) => ({ symbol: h.symbol, units: h.units })),
    settings,
    prices,
    priceFailures: missing.map((symbol) => ({ symbol, error: "no price stored yet" })),
  });

  const { totals } = valuePortfolio(holdings, prices, new Set(watchlist.map((w) => w.symbol)));
  const { recommendation: pick, ranked, excluded, skipped, freshness, targetSum } = result;
  const heldUnits = holdings.find((h) => h.symbol === pick?.symbol)?.units ?? 0;
  const targetsOff = watchlist.some((w) => w.targetPct !== null) && Math.abs(targetSum - 100) > 0.5;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      {/* ── run control ─────────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold sm:text-xl">Which ETF should I buy?</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
              Rs.{rupee0(settings.budget)} budget · gap weight {settings.gapWeight} ·{" "}
              {freshness.latestBar
                ? `data to ${freshness.latestBar}`
                : "no data yet"}
            </p>
          </div>
          <div className="sm:shrink-0">
            <RunButton hasPrices={prices.size > 0} />
          </div>
        </div>
        {!isDispatchConfigured() && (
          <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
            Tip: set <code>GITHUB_TOKEN</code> and <code>GITHUB_REPO</code> in Vercel and this
            button will fetch fresh prices too, not just re-score the stored ones.
          </p>
        )}
      </Card>

      {/* ── hard refusal on stale data ──────────────────────── */}
      {freshness.missedSession && (
        <Card className="overflow-hidden" as="div">
          <div className="flex" style={{ background: "var(--loss-soft)" }}>
            <div className="w-1 shrink-0" style={{ background: "var(--loss)" }} aria-hidden="true" />
            <div className="p-4 sm:p-5">
              <p className="font-semibold" style={{ color: "var(--loss)" }}>
                Stale data — no recommendation
              </p>
              <p className="mt-1 text-sm">{result.blockedReason}</p>
            </div>
          </div>
        </Card>
      )}

      {targetsOff && (
        <Card className="p-4" as="div">
          <p className="text-sm">
            Your targets add up to <strong>{targetSum.toFixed(1)}%</strong>, not 100%. Scoring still
            works, but the gaps won&apos;t mean quite what you expect —{" "}
            <Link href="/watchlist" className="underline">
              adjust them
            </Link>
            .
          </p>
        </Card>
      )}

      {/* ── the recommendation ──────────────────────────────── */}
      {pick ? (
        <Card className="overflow-hidden">
          <div className="flex" style={{ background: "var(--gain-soft)" }}>
            <div className="w-1 shrink-0" style={{ background: "var(--gain)" }} aria-hidden="true" />
            <div className="min-w-0 flex-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="gain">Buy</Pill>
                <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                  top of {ranked.length} eligible
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

              {/* Score breakdown — the two halves of the decision. */}
              <div
                className="mt-4 rounded-xl border p-3"
                style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
              >
                <p className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                  Why this one — score {pick.finalScore.toFixed(1)}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="tnum text-sm">
                      <strong>{pick.cheapnessAdjusted.toFixed(1)}</strong> cheapness
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {pick.cheapness.toFixed(1)}/100
                      {pick.confidence < 1 && (
                        <> × {(pick.confidence * 100).toFixed(0)}% confidence</>
                      )}{" "}
                      — {pick.ddNow.toFixed(1)}% off its {TREND_LONG}-day high, deeper than{" "}
                      {pick.ddPctile.toFixed(0)}% of its own dips
                    </p>
                  </div>
                  <div>
                    <p className="tnum text-sm">
                      <strong>{signedPts(pick.gapContribution)}</strong> allocation gap
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {pick.targetPct === null ? (
                        <>no target set, so no gap</>
                      ) : (
                        <>
                          at {pick.currentPct.toFixed(1)}% vs {pick.targetPct.toFixed(0)}% target ={" "}
                          {signedPts(pick.gapPct)}pt × {settings.gapWeight} weight
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <dl className="mt-3">
                <DefRow k="Trend" v={pick.detail} />
                <DefRow
                  k="NAV"
                  v={
                    pick.premiumPct !== null ? (
                      <span>
                        Rs.{rupee(pick.nav!)} — trading{" "}
                        <strong>{pick.premiumPct >= 0 ? "+" : "−"}
                        {Math.abs(pick.premiumPct).toFixed(2)}%</strong>{" "}
                        vs underlying (limit {settings.maxPremiumPct}%)
                        {pick.navAgeDays !== null && pick.navAgeDays > 0 && (
                          <> · NAV {pick.navAgeDays}d old</>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-2)" }}>
                        not checked — {pick.unavailable}
                      </span>
                    )
                  }
                />
                <DefRow
                  k="After buying"
                  v={`${pick.currentPct.toFixed(1)}% → ${pick.projectedPct.toFixed(1)}% of portfolio${
                    pick.targetPct !== null ? ` (target ${pick.targetPct.toFixed(0)}%)` : ""
                  }`}
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
        !freshness.missedSession && (
          <Card className="p-4 sm:p-5" as="div">
            <Pill tone="loss">No buy</Pill>
            <p className="mt-2 text-sm">{result.blockedReason}</p>
          </Card>
        )
      )}

      {/* ── portfolio summary ───────────────────────────────── */}
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
              delta={
                totals.invested > 0 ? (
                  <Delta value={totals.pnl} pct={totals.pnlPct} pctOnly />
                ) : undefined
              }
            />
            <StatTile
              label="Since prev close"
              value={signedRupee(totals.dayChange, { compact: true })}
              delta={<Delta value={totals.dayChange} pct={totals.dayChangePct} pctOnly />}
            />
          </div>
        </Card>
      )}

      {/* ── ranking ─────────────────────────────────────────── */}
      {ranked.length > 0 && (
        <Card>
          <CardHeader
            title="Ranking"
            hint="Score = cheapness (scored against each ETF's own history) + gap weight × how far below target it sits."
          />

          {/* Mobile cards */}
          <ul className="rows sm:hidden">
            {ranked.map((r, i) => {
              const skip = skipped.find((s) => s.symbol === r.symbol);
              return (
                <li key={r.symbol} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tnum text-sm" style={{ color: "var(--ink-2)" }}>
                          {i + 1}
                        </span>
                        <span className="font-semibold">{r.symbol}</span>
                        {pick?.symbol === r.symbol && <Pill tone="gain">picked</Pill>}
                        <Pill>{r.label}</Pill>
                      </div>
                      <p className="tnum mt-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
                        cheap {r.cheapnessAdjusted.toFixed(1)}
                        {r.confidence < 1 && ` (${(r.confidence * 100).toFixed(0)}% conf)`} · gap{" "}
                        {signedPts(r.gapContribution)}
                        {r.targetPct !== null && (
                          <> · {r.currentPct.toFixed(1)}% of {r.targetPct.toFixed(0)}%</>
                        )}
                      </p>
                      {skip && (
                        <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                          Skipped: {skip.reason}
                        </p>
                      )}
                    </div>
                    <p className="figure shrink-0 text-lg font-semibold">
                      {r.finalScore.toFixed(1)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
                >
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">ETF</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Cheapness</th>
                  <th className="px-3 py-2 text-right font-medium">Now / target</th>
                  <th className="px-3 py-2 text-right font-medium">Gap</th>
                  <th className="px-3 py-2 text-right font-medium">vs NAV</th>
                  <th className="px-5 py-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const skip = skipped.find((s) => s.symbol === r.symbol);
                  return (
                    <tr
                      key={r.symbol}
                      className="border-b last:border-0"
                      style={{ borderColor: "var(--hairline)" }}
                    >
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
                      <td className="tnum px-3 py-2.5 text-right font-semibold">
                        {r.finalScore.toFixed(1)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {r.cheapnessAdjusted.toFixed(1)}
                        {r.confidence < 1 && (
                          <span className="ml-1 text-xs" style={{ color: "var(--ink-2)" }}>
                            ({(r.confidence * 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {r.currentPct.toFixed(1)}%
                        <span style={{ color: "var(--ink-2)" }}>
                          {" / "}
                          {r.targetPct === null ? "—" : `${r.targetPct.toFixed(0)}%`}
                        </span>
                      </td>
                      <td
                        className="tnum px-3 py-2.5 text-right font-medium"
                        style={{
                          color:
                            r.gapPct > 0 ? "var(--gain)" : r.gapPct < 0 ? "var(--loss)" : undefined,
                        }}
                      >
                        {r.targetPct === null ? "—" : `${signedPts(r.gapPct)}pt`}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {r.premiumPct === null ? (
                          <span style={{ color: "var(--ink-2)" }}>—</span>
                        ) : (
                          <>
                            {r.premiumPct >= 0 ? "+" : "−"}
                            {Math.abs(r.premiumPct).toFixed(2)}%
                          </>
                        )}
                      </td>
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

      {/* ── excluded ────────────────────────────────────────── */}
      {excluded.length > 0 && (
        <Card>
          <CardHeader
            title="Not in the running"
            hint={`Dropped by the trend rule (under both the ${TREND_LONG}- and ${TREND_SHORT}-day averages), a premium over NAV, stale data, or less than ${settings.minCandles} sessions of history.`}
          />
          <ul className="rows">
            {excluded.map((e) => (
              <li key={e.symbol} className="px-4 py-3 sm:px-5">
                <span className="text-sm font-medium">{e.symbol}</span>
                <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                  {e.reason}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="px-1 text-xs" style={{ color: "var(--ink-2)" }}>
        Prices from Yahoo Finance and NAVs from AMFI, both via the scheduled fetcher
        {freshness.fetchedAt && (
          <> · last updated {new Date(freshness.fetchedAt).toLocaleString("en-IN")}</>
        )}
        . Cheapness uses a {PRICE_WINDOW}-session window. This tool reports numbers, places no
        orders, and is not financial advice.
      </p>
    </main>
  );
}
