import Link from "next/link";
import {
  CHEAPNESS_LOOKBACK,
  CHEAPNESS_WEIGHT,
  GAP_WEIGHT,
  type Candidate,
  type Recommendation,
  type StrategyResult,
} from "@/lib/strategy";
import type { PortfolioTotals } from "@/lib/valuation";
import { Page } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { RunBar } from "@/components/RunButton";
import { AlertIcon, BlockIcon, ChevronRightIcon } from "@/components/icons";
import {
  Banner,
  Card,
  CardHeader,
  DefRow,
  Delta,
  EmptyState,
  Eyebrow,
  MarkBar,
  Pill,
  Stat,
  buttonClass,
  compact,
  istStamp,
  rupee,
  rupee0,
  shortDate,
  signedPct,
  signedRupee,
} from "@/components/ui";

/**
 * The Advisor screen. Pure presentation: the page fetches and scores, this
 * lays it out — which is also what lets /preview render it from sample data.
 *
 * Phone order follows the job: today's pick, then the portfolio, then the
 * ranking that explains the pick. On wide screens the portfolio and the
 * excluded list move to a sidebar.
 */

export type AdvisorData = {
  result: StrategyResult;
  totals: PortfolioTotals;
  /** Units already held of the recommended ETF. */
  heldUnits: number;
  hasPrices: boolean;
  canFetch: boolean;
  /** Link prefix, so the preview links to its own pages. */
  base?: string;
};

const share = (weight: number) => `${(weight * 100).toFixed(0)}%`;

/** "2.3% below" / "1.1% above" — where the price sits against its recent average. */
const vsAverage = (belowPct: number) =>
  `${Math.abs(belowPct).toFixed(1)}% ${belowPct >= 0 ? "below" : "above"}`;

const signedPts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}pp`;

export function AdvisorView({ result, totals, heldUnits, hasPrices, canFetch, base = "" }: AdvisorData) {
  const { recommendation: pick, ranked, excluded, freshness, warnings, settings } = result;
  const link = (href: string) => `${base}${href}`;

  const status = freshness.fetchedAt
    ? `Prices updated ${istStamp(freshness.fetchedAt)}`
    : "No prices stored yet";

  const portfolio = totals.current > 0 && <PortfolioCard totals={totals} href={link("/portfolio")} />;

  return (
    <Page>
      <RunBar hasPrices={hasPrices} status={status} stale={freshness.missedSession} canFetch={canFetch} />

      {freshness.missedSession && (
        <Banner tone="error" title="Prices are out of date — no recommendation">
          {result.blockedReason}
        </Banner>
      )}

      {warnings.length > 0 && (
        <Banner tone="warn" title={warnings.length === 1 ? "One thing to check" : `${warnings.length} things to check`}>
          <ul className="space-y-1">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <Link href={link("/watchlist")} className="mt-1.5 inline-block font-medium text-accent">
            Open Watchlist
          </Link>
        </Banner>
      )}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-3 sm:space-y-4">
          {pick ? (
            <PickCard
              pick={pick}
              budget={settings.budget}
              bufferPct={settings.limitBufferPct}
              eligible={ranked.length}
              heldUnits={heldUnits}
              portfolioHref={link("/portfolio")}
            />
          ) : (
            !freshness.missedSession && <NoBuyCard reason={result.blockedReason} />
          )}

          {portfolio && <div className="lg:hidden">{portfolio}</div>}

          {ranked.length > 0 && <RankingCard ranked={ranked} pickSymbol={pick?.symbol ?? null} />}
        </div>

        <aside className="min-w-0 space-y-3 sm:space-y-4">
          {portfolio && <div className="hidden lg:block">{portfolio}</div>}
          {excluded.length > 0 && (
            // With nothing to buy, the exclusions ARE the explanation — open them.
            <ExcludedCard excluded={excluded} minCandles={settings.minCandles} open={!pick} />
          )}
        </aside>
      </div>

      <p className="px-1 pt-2 text-xs leading-relaxed text-ink-2">
        Prices from Yahoo Finance, NAVs from AMFI and NSE, via the scheduled fetcher
        {freshness.latestBar && <> · latest session {shortDate(freshness.latestBar)}</>}. This tool reports
        numbers, places no orders, and is not financial advice.
      </p>
    </Page>
  );
}

/** Nothing on the watchlist or holdings yet. */
export function AdvisorEmpty({ base = "" }: { base?: string }) {
  return (
    <Page>
      <Card>
        <EmptyState
          title="Nothing to work with yet"
          action={
            <Link href={`${base}/watchlist`} className={buttonClass("primary")}>
              Add ETFs to your watchlist
            </Link>
          }
        >
          Add the ETFs you want to buy on the Watchlist, and what you already own on Portfolio. The advisor
          picks one to buy each time you run it.
        </EmptyState>
      </Card>
    </Page>
  );
}

// ─── today's pick ───────────────────────────────────────────────────────────

function PickCard({
  pick,
  budget,
  bufferPct,
  eligible,
  heldUnits,
  portfolioHref,
}: {
  pick: Recommendation;
  budget: number;
  bufferPct: number;
  eligible: number;
  heldUnits: number;
  portfolioHref: string;
}) {
  const order = `${pick.symbol} BUY ${pick.qty} @ ${pick.limitPrice.toFixed(2)} LIMIT`;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Pill tone="gain">BUY</Pill>
            <Eyebrow>Today&apos;s pick</Eyebrow>
          </div>
          <span className="text-xs text-ink-2">
            top of {eligible} eligible
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="figure truncate text-[30px] font-semibold leading-none sm:text-4xl">{pick.symbol}</h1>
            <p className="mt-1.5 truncate text-sm text-ink-2">{pick.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="figure text-[30px] font-semibold leading-none text-accent sm:text-4xl">
              {pick.finalScore.toFixed(1)}
            </p>
            <p className="mt-1.5 text-xs text-ink-2">score of 100</p>
          </div>
        </div>

        {/* The order ticket — what to type into Groww. */}
        <div className="mt-5 grid grid-cols-3 divide-x divide-hairline rounded-xl border border-hairline bg-surface-2">
          <TicketCell label="Quantity" value={String(pick.qty)} />
          <TicketCell label="Limit price" value={`₹${rupee(pick.limitPrice)}`} />
          <TicketCell label="Amount" value={`₹${rupee0(pick.cost)}`} warn={pick.overBudget} />
        </div>

        {pick.overBudget && (
          <div className="mt-3 flex gap-2.5 rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] leading-relaxed">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <p>
              <strong className="font-semibold">₹{rupee0(-pick.leftover)} over your ₹{rupee0(budget)} budget.</strong>{" "}
              <span className="text-ink-2">
                One unit of {pick.symbol} costs more than the budget, so this is the minimum order of one unit.
              </span>
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-ink-2">
            Limit {bufferPct}% above ₹{rupee(pick.livePrice)}
            {!pick.overBudget && (
              <>
                {" "}
                · ₹{rupee0(pick.leftover)} of ₹{rupee0(budget)} unspent
              </>
            )}
          </p>
          <CopyButton text={order} />
        </div>
      </div>

      <div className="space-y-4 border-t border-hairline px-4 py-4 sm:px-5">
        <ScoreLine
          label="Cheapness"
          weight={share(CHEAPNESS_WEIGHT)}
          marks={pick.cheapnessMarks}
          detail={`${vsAverage(pick.belowAvgPct)} its ${CHEAPNESS_LOOKBACK}-day average of ₹${rupee(pick.recentAvg)}`}
        />
        <ScoreLine
          label="Allocation"
          weight={share(GAP_WEIGHT)}
          marks={pick.gapMarks}
          detail={
            pick.targetPct === null
              ? "No target set, so counted as on target"
              : `${pick.currentPct.toFixed(1)}% of your portfolio against a ${pick.targetPct.toFixed(0)}% target`
          }
        />
        <p className="text-xs leading-relaxed text-ink-2">
          {eligible === 1
            ? "Only one ETF is eligible, so both marks sit at a neutral 50."
            : `Marks compare the ${eligible} eligible ETFs with each other: the cheapest gets 100 for cheapness, the most underweight gets 100 for allocation.`}
        </p>
      </div>

      <dl className="rows border-t border-hairline px-4 sm:px-5">
        <DefRow k={pick.premiumSource === "inav" ? "vs iNAV" : "vs NAV"} v={<PremiumValue c={pick} />} />
        <DefRow
          k="After buying"
          v={
            <span className="tnum">
              {pick.currentPct.toFixed(1)}% → {pick.projectedPct.toFixed(1)}%
              {pick.targetPct !== null && <span className="text-ink-2"> of {pick.targetPct.toFixed(0)}%</span>}
            </span>
          }
        />
      </dl>

      <p className="border-t border-hairline bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2 sm:px-5">
        Place it yourself in Groww — check the live price there first. Once it fills, set {pick.symbol} to{" "}
        <strong className="text-ink">{heldUnits + pick.qty} units</strong> on{" "}
        <Link href={portfolioHref} className="font-medium text-accent">
          Portfolio
        </Link>
        .
      </p>
    </Card>
  );
}

function TicketCell({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <p className="flex items-center gap-1 text-[11px] font-medium text-ink-2">
        {label}
        {warn && (
          <>
            <AlertIcon className="h-3 w-3 text-warn" />
            <span className="sr-only">(over budget)</span>
          </>
        )}
      </p>
      <p className="figure mt-0.5 truncate text-lg font-semibold sm:text-xl">{value}</p>
    </div>
  );
}

function ScoreLine({
  label,
  weight,
  marks,
  detail,
}: {
  label: string;
  weight: string;
  marks: number;
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {label} <span className="text-xs font-normal text-ink-2">· {weight} of score</span>
        </p>
        <p className="tnum text-sm font-semibold">
          {marks.toFixed(0)}
          <span className="font-normal text-ink-2">/100</span>
        </p>
      </div>
      <MarkBar value={marks} label={`${label}: ${marks.toFixed(0)} out of 100`} className="mt-2" />
      <p className="mt-1.5 text-xs text-ink-2">{detail}</p>
    </div>
  );
}

function PremiumValue({ c }: { c: Candidate }) {
  if (c.premiumPct === null) {
    return <span className="text-ink-2">not checked — {c.premiumUnavailable}</span>;
  }
  return (
    <span className="tnum">
      {signedPct(c.premiumPct)}
      <span className="text-ink-2">
        {" "}
        at ₹{rupee(c.referenceValue!)}
        {c.premiumPctile !== null && <> · {c.premiumPctile.toFixed(0)}th pctile</>}
      </span>
    </span>
  );
}

function NoBuyCard({ reason }: { reason: string | null }) {
  return (
    <Card>
      <div className="flex gap-3 p-4 sm:p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-loss-soft text-loss">
          <BlockIcon />
        </span>
        <div className="min-w-0">
          <Eyebrow>Today&apos;s pick</Eyebrow>
          <h1 className="mt-1 text-lg font-semibold">No buy this time</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{reason}</p>
        </div>
      </div>
    </Card>
  );
}

// ─── portfolio summary ──────────────────────────────────────────────────────

function PortfolioCard({ totals, href }: { totals: PortfolioTotals; href: string }) {
  const hasBasis = totals.invested > 0;
  return (
    <Card>
      <Link href={href} className="block p-4 transition hover:bg-surface-2/60 sm:p-5">
        <div className="flex items-center justify-between">
          <Eyebrow>Portfolio</Eyebrow>
          <span className="flex items-center text-xs font-medium text-accent">
            Holdings <ChevronRightIcon className="h-4 w-4" />
          </span>
        </div>
        <p className="figure mt-2 text-3xl font-semibold">₹{rupee0(totals.current)}</p>
        <div className="mt-1 flex items-baseline gap-1.5">
          <Delta value={totals.dayChange} pct={totals.dayChangePct} size="sm" />
          <span className="text-xs text-ink-2">today</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3.5">
          <Stat size="sm" label="Invested" value={hasBasis ? `₹${compact(totals.invested)}` : "—"} />
          <Stat
            size="sm"
            label="Total returns"
            value={
              hasBasis ? (
                <span className={totals.pnl >= 0 ? "text-gain" : "text-loss"}>
                  {signedRupee(totals.pnl, { compact: true })}
                </span>
              ) : (
                "—"
              )
            }
            sub={hasBasis && totals.pnlPct !== null ? signedPct(totals.pnlPct) : undefined}
          />
        </div>
      </Link>
    </Card>
  );
}

// ─── ranking ────────────────────────────────────────────────────────────────

function RankingCard({ ranked, pickSymbol }: { ranked: Candidate[]; pickSymbol: string | null }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Ranking"
        count={ranked.length}
        hint={`${share(CHEAPNESS_WEIGHT)} cheapness against the ${CHEAPNESS_LOOKBACK}-day average + ${share(GAP_WEIGHT)} allocation gap, each marked 0–100 against the others. Tap a row for detail.`}
      />

      {/* Column heads — wide screens only; phones read each row as a card. */}
      <div className="hidden grid-cols-[2rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_4rem_1.25rem] gap-4 border-b border-hairline px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2 sm:grid">
        <span>#</span>
        <span>ETF</span>
        <span>Cheapness</span>
        <span>Allocation</span>
        <span className="text-right">vs NAV</span>
        <span className="text-right">Score</span>
        <span />
      </div>

      <div className="rows">
        {ranked.map((r, i) => (
          <RankRow key={r.symbol} r={r} rank={i + 1} picked={r.symbol === pickSymbol} />
        ))}
      </div>
    </Card>
  );
}

function RankRow({ r, rank, picked }: { r: Candidate; rank: number; picked: boolean }) {
  const allocationText =
    r.targetPct === null ? "no target" : `${r.currentPct.toFixed(1)}% of ${r.targetPct.toFixed(0)}%`;

  return (
    <details className="group">
      <summary className="px-4 py-3.5 transition hover:bg-surface-2/60 active:bg-surface-2 sm:px-5">
        {/* phone */}
        <div className="sm:hidden">
          <div className="flex items-center gap-3">
            <span className="tnum w-4 shrink-0 text-sm text-ink-2">{rank}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{r.symbol}</span>
                {picked && <Pill tone="gain">PICK</Pill>}
              </div>
              <p className="tnum mt-0.5 truncate text-xs text-ink-2">
                {vsAverage(r.belowAvgPct)} avg · {allocationText}
              </p>
            </div>
            <span className="figure shrink-0 text-xl font-semibold">{r.finalScore.toFixed(1)}</span>
            <ChevronRightIcon className="chevron h-4 w-4 shrink-0 text-ink-2" />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-4 pl-7 pr-7">
            <MiniMark label="Cheap" value={r.cheapnessMarks} />
            <MiniMark label="Alloc" value={r.gapMarks} />
          </div>
        </div>

        {/* wide */}
        <div className="hidden grid-cols-[2rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_4rem_1.25rem] items-center gap-4 sm:grid">
          <span className="tnum text-sm text-ink-2">{rank}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{r.symbol}</span>
              {picked && <Pill tone="gain">PICK</Pill>}
            </div>
            <p className="truncate text-xs text-ink-2">{r.name}</p>
          </div>
          <MarkCell value={r.cheapnessMarks} label="Cheapness" note={`${vsAverage(r.belowAvgPct)} avg`} />
          <MarkCell value={r.gapMarks} label="Allocation" note={allocationText} />
          <span className="tnum text-right text-sm">
            {r.premiumPct === null ? <span className="text-ink-2">—</span> : signedPct(r.premiumPct)}
          </span>
          <span className="figure text-right text-lg font-semibold">{r.finalScore.toFixed(1)}</span>
          <ChevronRightIcon className="chevron h-4 w-4 text-ink-2" />
        </div>
      </summary>

      <dl className="grid gap-x-8 border-t border-hairline bg-surface-2/60 px-4 py-2 sm:grid-cols-2 sm:px-5">
        <DefRow k="Price" v={<span className="tnum">₹{rupee(r.livePrice)}</span>} />
        <DefRow k={`${CHEAPNESS_LOOKBACK}-day average`} v={<span className="tnum">₹{rupee(r.recentAvg)}</span>} />
        <DefRow k="vs average" v={<span className="tnum">{signedPct(-r.belowAvgPct)}</span>} />
        <DefRow k="Cheapness marks" v={<span className="tnum">{r.cheapnessMarks.toFixed(0)} / 100</span>} />
        <DefRow k="Weight now" v={<span className="tnum">{r.currentPct.toFixed(1)}%</span>} />
        <DefRow
          k="Target"
          v={
            <span className="tnum">
              {r.targetPct === null ? "—" : `${r.targetPct.toFixed(0)}% (${signedPts(r.gapPct)})`}
            </span>
          }
        />
        <DefRow k="Allocation marks" v={<span className="tnum">{r.gapMarks.toFixed(0)} / 100</span>} />
        <DefRow k={r.premiumSource === "inav" ? "vs iNAV" : "vs NAV"} v={<PremiumValue c={r} />} />
        <DefRow
          k="Order"
          v={
            <span className="tnum">
              {r.qty} × ₹{rupee(r.limitPrice)} = ₹{rupee0(r.cost)}
              {r.overBudget && <span className="text-warn"> · over budget</span>}
            </span>
          }
        />
      </dl>
    </details>
  );
}

function MiniMark({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[11px] font-medium text-ink-2">{label}</span>
      <MarkBar value={value} label={`${label}: ${value.toFixed(0)} of 100`} className="flex-1" />
      <span className="tnum w-6 shrink-0 text-right text-[11px] font-semibold">{value.toFixed(0)}</span>
    </div>
  );
}

function MarkCell({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <MarkBar value={value} label={`${label}: ${value.toFixed(0)} of 100`} className="flex-1" />
        <span className="tnum w-7 shrink-0 text-right text-sm font-semibold">{value.toFixed(0)}</span>
      </div>
      <p className="tnum mt-1 truncate text-xs text-ink-2">{note}</p>
    </div>
  );
}

// ─── excluded ───────────────────────────────────────────────────────────────

function ExcludedCard({
  excluded,
  minCandles,
  open,
}: {
  excluded: StrategyResult["excluded"];
  minCandles: number;
  open: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <details open={open}>
        <summary className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-surface-2/60 sm:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              Not in the running
              <span className="tnum rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                {excluded.length}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-ink-2">
              Stale data, under {minCandles} sessions of history, or a premium over NAV.
            </p>
          </div>
          <ChevronRightIcon className="chevron h-4 w-4 shrink-0 text-ink-2" />
        </summary>
        <ul className="rows border-t border-hairline">
          {excluded.map((e) => (
            <li key={e.symbol} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold">{e.symbol}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{e.reason}</p>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
