import Link from "next/link";
import { getHoldings, getSettings, getWatchlist } from "@/lib/data";
import { isAllowed } from "@/lib/supabase/server";
import { getPrices, STALE_AFTER_MINUTES } from "@/lib/prices";
import { runStrategy, TREND_LONG, TREND_SHORT } from "@/lib/strategy";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";

// Prices move; never serve this from a cache.
export const dynamic = "force-dynamic";

const rupee = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default async function AdvisorPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [watchlist, holdings, settings] = await Promise.all([
    getWatchlist(),
    getHoldings(),
    getSettings(),
  ]);

  // Price held symbols too, so portfolio weights are honest.
  const symbols = Array.from(
    new Set([...watchlist.map((w) => w.symbol), ...holdings.map((h) => h.symbol)]),
  );

  if (symbols.length === 0) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <Empty />
      </main>
    );
  }

  const { data: prices, missing, fetchedAt, ageMinutes, isStale } = await getPrices(symbols);

  const result = runStrategy({
    watchlist,
    holdings,
    budget: settings.budget,
    maxWeightPct: settings.maxWeightPct,
    limitBufferPct: settings.limitBufferPct,
    prices,
    priceFailures: missing.map((symbol) => ({
      symbol,
      error: "no price row yet — the price fetcher hasn't covered this symbol",
    })),
  });

  const { recommendation: pick, portfolio, ranked, discarded, unscorable, skipped } = result;
  const heldUnits = holdings.find((h) => h.symbol === pick?.symbol)?.units ?? 0;
  const noPricesAtAll = fetchedAt === null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* ── data freshness ─────────────────────────────────────── */}
      {noPricesAtAll && (
        <section className="rounded-xl border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950/40">
          <h2 className="font-semibold text-red-800 dark:text-red-300">No price data yet</h2>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            The <code>prices</code> table is empty. Run the{" "}
            <strong>Fetch ETF prices</strong> GitHub Action once (Actions tab → Run workflow) to
            populate it. Nothing can be scored until then.
          </p>
        </section>
      )}

      {isStale && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>Prices are {ageMinutes} minutes old</strong> (older than{" "}
            {STALE_AFTER_MINUTES} min). The scheduled fetch may have failed — check the GitHub
            Action. Treat the numbers below as indicative only.
          </p>
        </section>
      )}

      {/* ── recommendation ─────────────────────────────────────── */}
      {pick ? (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Buy
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {pick.symbol}{" "}
            <span className="text-base font-normal text-slate-600 dark:text-slate-400">
              {pick.name}
            </span>
          </h1>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Units" value={String(pick.qty)} />
            <Stat label="Limit price" value={`Rs.${rupee(pick.limitPrice)}`} />
            <Stat label="Total" value={`Rs.${rupee(pick.cost)}`} />
          </div>

          <dl className="mt-4 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <Row
              k="Cheapness"
              v={`${pick.cheapness.toFixed(1)}/100 — ${pick.ddNow.toFixed(1)}% off its ${TREND_LONG}-day high, deeper than ${pick.ddPctile.toFixed(0)}% of its own dips`}
            />
            <Row k="Trend" v={pick.detail} />
            <Row
              k="Portfolio"
              v={`currently ${pick.weight.toFixed(1)}% of your holdings (cap ${result.maxWeightPct.toFixed(0)}%)`}
            />
            <Row
              k="Live price"
              v={`Rs.${rupee(pick.livePrice)} — limit is +${result.limitBufferPct.toFixed(2)}%`}
            />
            <Row k="Left unspent" v={`Rs.${rupee(pick.leftover)}`} />
          </dl>

          <p className="mt-4 rounded-lg bg-white/70 p-3 text-sm text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
            Place this yourself in the Groww app — confirm the live price there first. Once it
            fills, set {pick.symbol} to <strong>{heldUnits + pick.qty}</strong> units on the{" "}
            <Link href="/portfolio" className="underline">
              Portfolio
            </Link>{" "}
            page.
          </p>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            No recommendation
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{result.noPickReason}</p>
        </section>
      )}

      {/* ── warnings ───────────────────────────────────────────── */}
      {unscorable.length > 0 && (
        <section className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
          {unscorable.map((u) => (
            <p key={u.symbol} className="text-amber-700 dark:text-amber-400">
              <strong>{u.symbol}</strong> not scored: {u.reason}
            </p>
          ))}
        </section>
      )}

      {/* ── cheapness ranking ──────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-semibold">Cheapness ranking</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Each ETF scored against its <em>own</em> history, higher = cheaper. The rupee price
            level is irrelevant.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <Th>#</Th>
                <Th>ETF</Th>
                <Th right>Score</Th>
                <Th right>In own range</Th>
                <Th right>Dip now</Th>
                <Th right>Dip vs own</Th>
                <Th right>Trend</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const skip = skipped.find((s) => s.symbol === r.symbol);
                return (
                  <tr key={r.symbol} className="border-t border-slate-100 dark:border-slate-800">
                    <Td>{i + 1}</Td>
                    <Td>
                      <span className="font-medium">{r.symbol}</span>
                      {pick?.symbol === r.symbol && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                          picked
                        </span>
                      )}
                      {skip && (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          {skip.reason}
                        </span>
                      )}
                    </Td>
                    <Td right strong>
                      {r.cheapness.toFixed(1)}
                    </Td>
                    <Td right>{r.pricePctile.toFixed(0)}%</Td>
                    <Td right>{r.ddNow.toFixed(1)}%</Td>
                    <Td right>{r.ddPctile.toFixed(0)}%</Td>
                    <Td right>{r.label}</Td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Nothing passed the trend check.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── discarded ──────────────────────────────────────────── */}
      {discarded.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">
            Discarded — under both the {TREND_LONG}-day and {TREND_SHORT}-day averages
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
            {discarded.map((d) => (
              <li key={d.symbol}>
                <span className="font-medium text-slate-800 dark:text-slate-200">{d.symbol}</span>{" "}
                — {d.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── portfolio ──────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-semibold">Portfolio</h2>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Total Rs.{whole(portfolio.total)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <Th>ETF</Th>
                <Th right>Units</Th>
                <Th right>Price</Th>
                <Th right>Value</Th>
                <Th right>Weight</Th>
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.map((row) => (
                <tr key={row.symbol} className="border-t border-slate-100 dark:border-slate-800">
                  <Td>
                    <span className="font-medium">{row.symbol}</span>
                    {!row.onWatchlist && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        not on watchlist
                      </span>
                    )}
                  </Td>
                  <Td right>{row.units}</Td>
                  <Td right>{row.priced ? rupee(row.price) : "n/a"}</Td>
                  <Td right>{whole(row.value)}</Td>
                  <Td right>{row.weight.toFixed(1)}%</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="pb-4 text-xs text-slate-500 dark:text-slate-400">
        Data: Yahoo Finance via the scheduled fetcher
        {fetchedAt
          ? `, last updated ${new Date(fetchedAt).toLocaleString("en-IN")}${
              ageMinutes !== null ? ` (${ageMinutes} min ago)` : ""
            }`
          : ""}
        . To refresh now, run the <strong>Fetch ETF prices</strong> workflow in GitHub Actions.
        This tool reports numbers — it places no orders and is not financial advice.
      </p>
    </main>
  );
}

/* ── small presentational helpers ──────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 p-3 dark:bg-slate-900/60">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2 ${right ? "text-right tabular-nums" : ""} ${
        strong ? "font-semibold" : ""
      }`}
    >
      {children}
    </td>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-lg font-semibold">Nothing to work with yet</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Add the ETFs you&apos;re interested in on the{" "}
        <Link href="/watchlist" className="underline">
          Watchlist
        </Link>{" "}
        page, and what you already own on the{" "}
        <Link href="/portfolio" className="underline">
          Portfolio
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
