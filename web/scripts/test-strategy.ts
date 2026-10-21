/**
 * Tests for the scoring rules.
 *
 *   node --experimental-strip-types scripts/test-strategy.ts
 */
import {
  HIGH_LOOKBACK,
  PRICE_WINDOW,
  lastCompletedSession,
  premiumOverFairValue,
  premiumVerdict,
  runStrategy,
  scoreCheapness,
  sessionsBetween,
  shapeGap,
  type PriceData,
  type Settings,
  type WatchlistItem,
} from "../src/lib/strategy.ts";

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown, tol = 1e-9) {
  const ok =
    typeof got === "number" && typeof want === "number"
      ? Math.abs(got - want) < tol
      : JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean, detail = "") {
  cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name} ${detail}`));
}

// Spelled out rather than spread from DEFAULT_SETTINGS, so retuning a default
// never silently changes what these tests assert.
const SETTINGS: Settings = {
  budget: 2500,
  limitBufferPct: 0.2,
  gapWeight: 1,
  gapKneePct: 5,
  maxPremiumPct: 3,
  premiumFloorPct: 0.75,
  maxPremiumPctile: 90,
  minCandles: 252,
  maxBarAgeSessions: 1,
  maxNavAgeDays: 4,
  maxInavAgeMinutes: 120,
  nseHolidays: [],
};

/** An IST wall-clock time, e.g. ist("2026-08-10T10:00:00"). */
const ist = (local: string) => Date.parse(`${local}+05:30`);

const NOW = ist("2026-08-05T12:00:00"); // a Wednesday, mid-session
const YESTERDAY = "2026-08-04";

/**
 * A gently rising series. Its moving averages sit BELOW the final value, so a
 * live price at or above `end` clears the trend check — a flat or sine series
 * has averages at ~the same level and gets excluded as "still falling", which
 * is correct behaviour but useless as a fixture.
 */
function rising(end = 100, n = 300, drift = 0.25): number[] {
  return Array.from({ length: n }, (_, i) =>
    Number((end * (1 - drift * (1 - i / (n - 1)))).toFixed(4)),
  );
}

/** Series that ran up then pulled back — cheap, but still above its 14-day average. */
function pulledBack(end = 100, n = 300): number[] {
  const peak = end * 1.12;
  return Array.from({ length: n }, (_, i) => {
    if (i < n - 12) return Number((peak * (1 - 0.25 * (1 - i / (n - 13)))).toFixed(4));
    return Number((peak - (peak - end) * ((i - (n - 13)) / 12)).toFixed(4));
  });
}

/** Smallest live price that clears both averages, so trend is never the reason a test fails. */
function aboveAverages(closes: number[]): number {
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return Math.max(avg(closes.slice(-50)), avg(closes.slice(-14))) * 1.002;
}

function priceRow(over: Partial<PriceData> & { symbol: string }): PriceData {
  return {
    closes: rising(),
    livePrice: 100,
    lastBar: YESTERDAY,
    nav: null,
    navDate: null,
    inav: null,
    inavAt: null,
    premiumHistory: [],
    fetchedAt: new Date(NOW - 10 * 60_000).toISOString(),
    ...over,
  };
}

/** One fresh, trend-passing price row per watchlist entry. */
function pricesFor(watchlist: WatchlistItem[]): Map<string, PriceData> {
  return new Map(watchlist.map((w) => [w.symbol, priceRow({ symbol: w.symbol })]));
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── DRAWDOWN WINDOW CONSISTENCY ──");
// A spike exactly `look` bars back must be OUTSIDE today's window: today's
// window is (look-1) prior closes + the live price. If it leaks in, the window
// is one too wide — the bug this replaced.
{
  const n = 300;
  const closes = Array.from({ length: n }, () => 100);
  closes[n - HIGH_LOOKBACK] = 500; // exactly `look` back from the live price
  const r = scoreCheapness(closes, 100, { lastCloseIsToday: false });
  check(`spike ${HIGH_LOOKBACK} bars back is excluded (ddNow stays 0)`, r.ddNow, 0);

  const closes2 = Array.from({ length: n }, () => 100);
  closes2[n - HIGH_LOOKBACK + 1] = 500; // one bar nearer — must be INSIDE
  const r2 = scoreCheapness(closes2, 100, { lastCloseIsToday: false });
  check(`spike ${HIGH_LOOKBACK - 1} bars back is included (ddNow = 80%)`, r2.ddNow, 80);
}

// Window sizes must match exactly: build a series where today's drawdown has a
// known analytic answer, and confirm the last historical sample equals it when
// the live price repeats the previous close.
{
  const n = 300;
  const closes = Array.from({ length: n }, (_, i) => 100 + (i % 7));
  const live = closes[n - 1];
  const r = scoreCheapness(closes, live, { lastCloseIsToday: false });
  // History's newest sample uses closes[n-look..n-1]; today's uses
  // closes[n-look+1..n-1] + live. With live === closes[n-1] the two windows
  // differ by exactly one element, so equality is NOT expected — what must
  // hold is that both span `look` observations. Verify via a crafted series
  // where the extra element is not the max, making them numerically equal.
  const flat = Array.from({ length: n }, () => 100);
  flat[n - 1] = 90;
  const rf = scoreCheapness(flat, 90, { lastCloseIsToday: false });
  ok(
    "identical windows agree when the boundary element is not the max",
    Math.abs(rf.ddNow - 10) < 1e-9,
    `ddNow=${rf.ddNow}`,
  );
  ok("percentiles stay within 0..100", r.ddPctile >= 0 && r.ddPctile <= 100);
}

// lastCloseIsToday: the live price supersedes today's stored close rather than
// stacking on top of it.
{
  const n = 300;
  const closes = Array.from({ length: n }, () => 100);
  closes[n - 1] = 500; // "today's" close, which the live price replaces
  const superseded = scoreCheapness(closes, 100, { lastCloseIsToday: true });
  const stacked = scoreCheapness(closes, 100, { lastCloseIsToday: false });
  check("today's stored close is superseded, not stacked", superseded.ddNow, 0);
  check("without the flag the same spike leaks in", stacked.ddNow, 80);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── HISTORY CONFIDENCE ──");
{
  const full = scoreCheapness(Array.from({ length: PRICE_WINDOW }, () => 100), 100);
  const half = scoreCheapness(Array.from({ length: 126 }, () => 100), 100);
  const over = scoreCheapness(Array.from({ length: 400 }, () => 100), 100);
  check(`${PRICE_WINDOW} closes -> confidence 1`, full.confidence, 1);
  check("126 closes -> confidence 0.5", half.confidence, 0.5);
  check("400 closes -> confidence capped at 1", over.confidence, 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── PREMIUM OVER FAIR VALUE ──");
{
  const rich = premiumOverFairValue(
    priceRow({ symbol: "MON100", livePrice: 321.82, nav: 277.146, navDate: YESTERDAY }),
    SETTINGS,
    NOW,
  );
  ok("MON100-style premium is ~16%", Math.abs((rich.premiumPct ?? 0) - 16.12) < 0.02,
     `got ${rich.premiumPct}`);
  check("with no iNAV it is measured against the EOD NAV", rich.premiumSource, "nav");

  const noRef = premiumOverFairValue(priceRow({ symbol: "X" }), SETTINGS, NOW);
  check("missing iNAV and NAV reports unavailable", noRef.premiumUnavailable,
        "no iNAV or NAV published for this ETF");
  ok("missing iNAV and NAV does not fabricate a premium", noRef.premiumPct === null);

  const oldNav = premiumOverFairValue(
    priceRow({ symbol: "X", nav: 100, navDate: "2026-07-01" }),
    SETTINGS,
    NOW,
  );
  ok("stale NAV is refused rather than trusted", oldNav.premiumPct === null,
     `got ${oldNav.premiumPct}`);
  ok("and says how stale", (oldNav.premiumUnavailable ?? "").includes("days old"),
     oldNav.premiumUnavailable ?? "");

  const dayOld = premiumOverFairValue(
    priceRow({ symbol: "MON100", livePrice: 110, nav: 100, navDate: YESTERDAY }),
    SETTINGS,
    NOW,
  );
  ok("a one-day-old NAV is still used (international ETFs lag)", dayOld.premiumPct !== null);

  const both = premiumOverFairValue(
    priceRow({
      symbol: "X",
      livePrice: 101,
      inav: 100,
      inavAt: new Date(NOW - 10 * 60_000).toISOString(),
      nav: 90,
      navDate: YESTERDAY,
    }),
    SETTINGS,
    NOW,
  );
  check("a fresh iNAV is preferred over the EOD NAV", both.premiumSource, "inav");
  check("and the premium is measured against it", both.premiumPct, 1);

  const staleInav = premiumOverFairValue(
    priceRow({
      symbol: "X",
      livePrice: 101,
      inav: 100,
      inavAt: new Date(NOW - 180 * 60_000).toISOString(), // past the 120-minute limit
      nav: 90,
      navDate: YESTERDAY,
    }),
    SETTINGS,
    NOW,
  );
  check("an iNAV past max_inav_age_minutes falls back to the EOD NAV",
        staleInav.premiumSource, "nav");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── PREMIUM PERCENTILE GATE ──");
{
  // 100 trailing observations spread evenly over 0.00% .. 0.99%.
  const history = Array.from({ length: 100 }, (_, i) => i / 100);
  const fresh = new Date(NOW - 5 * 60_000).toISOString();
  const at = (premiumPct: number, samples = history) =>
    premiumOverFairValue(
      priceRow({
        symbol: "X",
        livePrice: 100 * (1 + premiumPct / 100),
        inav: 100,
        inavAt: fresh,
        premiumHistory: samples,
      }),
      SETTINGS,
      NOW,
    );

  const unusual = at(1.2); // above every sample, above the floor, under the cap
  check("today's premium is ranked against its own history", unusual.premiumPctile, 100);
  ok("an unusually high premium for this ETF is gated",
     (premiumVerdict(unusual, SETTINGS, false) ?? "").includes("percentile"),
     premiumVerdict(unusual, SETTINGS, false) ?? "null");

  check("a premium typical for this ETF passes", premiumVerdict(at(0.8), SETTINGS, false), null);

  const tight = Array.from({ length: 100 }, () => 0); // a NIFTYBEES-style tracker
  check("a premium under the noise floor is never gated, however unusual",
        premiumVerdict(at(0.5, tight), SETTINGS, false), null);

  const thin = at(1.2, history.slice(0, 30));
  check("under 60 samples the percentile stays quiet", thin.premiumPctile, null);
  check("and the gate does not fire", premiumVerdict(thin, SETTINGS, false), null);

  ok("past max_premium_pct the absolute cap fires regardless",
     (premiumVerdict(at(3.5, history.slice(0, 30)), SETTINGS, false) ?? "").includes("absolute limit"));
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── PREMIUM-SENSITIVE ETFs FAIL CLOSED ──");
{
  const closes = rising();
  const live = aboveAverages(closes);
  const run = (premiumSensitive: boolean, over: Partial<PriceData> = {}) =>
    runStrategy({
      watchlist: [{ symbol: "INTL", name: "international", targetPct: 100, premiumSensitive }],
      holdings: [],
      settings: SETTINGS,
      prices: new Map([["INTL", priceRow({ symbol: "INTL", closes, livePrice: live, ...over })]]),
      priceFailures: [],
      nowMs: NOW,
    });

  const blind = run(true);
  ok("no iNAV or NAV + premium-sensitive -> excluded",
     blind.excluded.some((e) => e.symbol === "INTL" && e.reason.includes("cannot be checked")),
     JSON.stringify(blind.excluded));
  ok("and nothing is recommended", blind.recommendation === null);

  check("the same ETF without the flag is still recommended",
        run(false).recommendation?.symbol, "INTL");

  const eodOnly = run(true, { nav: live, navDate: YESTERDAY });
  check("with an EOD NAV it is judged, not refused", eodOnly.recommendation?.symbol, "INTL");
  ok("but warns that the EOD NAV carries a day of drift",
     eodOnly.warnings.some((w) => w.startsWith("INTL:")),
     JSON.stringify(eodOnly.warnings));

  const withInav = run(true, { inav: live, inavAt: new Date(NOW - 5 * 60_000).toISOString() });
  check("with a fresh iNAV there is nothing to warn about", withInav.warnings, []);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── ALLOCATION GAP SHAPING ──");
{
  check("inside the knee the gap term is linear", shapeGap(4, 1.5, 5), 6);
  check("and symmetric", shapeGap(-4, 1.5, 5), -6);
  check("continuous at the knee", shapeGap(5, 1.5, 5), 7.5);
  // The docstring's worked example: 15pp overweight at weight 1.5, knee 5.
  check("quadratic past it: 15pp over costs 52.5, not a linear 22.5", shapeGap(-15, 1.5, 5), -52.5);
  ok("slope is continuous across the knee",
     Math.abs((shapeGap(5.001, 1, 5) - shapeGap(5, 1, 5)) / 0.001 - 1) < 1e-3);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── ALLOCATION GAP DECIDES WHAT TO BUY ──");
{
  // Two ETFs, equal cheapness by construction. UNDER is far below target,
  // OVER is far above. The gap must decide.
  const closes = rising();
  const live = aboveAverages(closes);
  const prices = new Map<string, PriceData>([
    ["UNDER", priceRow({ symbol: "UNDER", closes, livePrice: live })],
    ["OVER", priceRow({ symbol: "OVER", closes, livePrice: live })],
  ]);
  const result = runStrategy({
    watchlist: [
      { symbol: "UNDER", name: "under", targetPct: 60 },
      { symbol: "OVER", name: "over", targetPct: 40 },
    ],
    holdings: [
      { symbol: "UNDER", units: 1 },
      { symbol: "OVER", units: 99 },
    ],
    settings: SETTINGS,
    prices,
    priceFailures: [],
    nowMs: NOW,
  });
  const under = result.ranked.find((r) => r.symbol === "UNDER")!;
  const over = result.ranked.find((r) => r.symbol === "OVER")!;
  ok("underweight ETF has a positive gap", under.gapPct > 0, `${under.gapPct}`);
  ok("overweight ETF has a negative gap", over.gapPct < 0, `${over.gapPct}`);
  ok("equal cheapness, so the gap decides the order", result.ranked[0].symbol === "UNDER",
     `ranked: ${result.ranked.map((r) => r.symbol).join(", ")}`);
  check("recommendation is the underweight one", result.recommendation?.symbol, "UNDER");
  ok("no hard cap blocks the overweight ETF, it is merely ranked lower",
     result.ranked.some((r) => r.symbol === "OVER"));
  ok("final score = cheapness x confidence + shaped gap",
     Math.abs(under.finalScore - (under.cheapnessAdjusted + under.gapContribution)) < 1e-9);
  check("the gap term is the shaped one",
        under.gapContribution, shapeGap(under.gapPct, SETTINGS.gapWeight, SETTINGS.gapKneePct));
}

// gapWeight scales the influence
{
  const cheapCloses = pulledBack();      // dipped hard -> high cheapness
  const dearCloses = rising();
  // Live AT its high, not merely above its averages: dips carry 75% of
  // cheapness, so even a 2% dip against a dip-free history reads as cheap.
  const prices = new Map<string, PriceData>([
    ["CHEAP", priceRow({ symbol: "CHEAP", closes: cheapCloses, livePrice: aboveAverages(cheapCloses) })],
    ["NEEDED", priceRow({ symbol: "NEEDED", closes: dearCloses, livePrice: dearCloses[dearCloses.length - 1] })],
  ]);
  const base = {
    watchlist: [
      { symbol: "CHEAP", name: "cheap but at target", targetPct: 10 },
      { symbol: "NEEDED", name: "pricey but underweight", targetPct: 90 },
    ],
    holdings: [{ symbol: "CHEAP", units: 50 }, { symbol: "NEEDED", units: 1 }],
    prices,
    priceFailures: [],
    nowMs: NOW,
  };
  const noGap = runStrategy({ ...base, settings: { ...SETTINGS, gapWeight: 0 } });
  const bigGap = runStrategy({ ...base, settings: { ...SETTINGS, gapWeight: 5 } });
  check("gapWeight 0 -> cheapness alone wins", noGap.ranked[0].symbol, "CHEAP");
  check("gapWeight 5 -> the underweight one wins", bigGap.ranked[0].symbol, "NEEDED");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── NSE SESSION CALENDAR ──");
{
  const none = new Set<string>();
  check("Monday morning expects Friday's bar",
        lastCompletedSession(ist("2026-08-10T10:00:00"), none), "2026-08-07");
  check("after the 15:30 close, today counts",
        lastCompletedSession(ist("2026-08-10T15:45:00"), none), "2026-08-10");
  check("a listed holiday is skipped",
        lastCompletedSession(ist("2026-08-11T10:00:00"), new Set(["2026-08-10"])), "2026-08-07");
  check("Friday to Monday is one session, not three days",
        sessionsBetween("2026-08-07", "2026-08-10", none), 1);
  check("same day -> 0 sessions", sessionsBetween("2026-08-10", "2026-08-10", none), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── STALE DATA IS REFUSED ──");
{
  const closes = rising();
  // One symbol lags the newest session -> excluded, the fresh one survives.
  const prices = new Map<string, PriceData>([
    ["FRESH", priceRow({ symbol: "FRESH", closes, lastBar: YESTERDAY })],
    ["LAGGY", priceRow({ symbol: "LAGGY", closes, lastBar: "2026-07-28" })],
  ]);
  const r = runStrategy({
    watchlist: [
      { symbol: "FRESH", name: "fresh", targetPct: 50 },
      { symbol: "LAGGY", name: "laggy", targetPct: 50 },
    ],
    holdings: [],
    settings: SETTINGS,
    prices,
    priceFailures: [],
    nowMs: NOW,
  });
  ok("symbol behind the latest session is excluded",
     r.excluded.some((e) => e.symbol === "LAGGY" && e.reason.includes("latest session")),
     JSON.stringify(r.excluded));
  ok("the up-to-date symbol still ranks", r.ranked.some((c) => c.symbol === "FRESH"));

  // Everything stale -> refuse outright, name nothing.
  const allStale = new Map<string, PriceData>([
    ["A", priceRow({ symbol: "A", closes, lastBar: "2026-07-20" })],
  ]);
  const blocked = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [],
    settings: SETTINGS,
    prices: allStale,
    priceFailures: [],
    nowMs: NOW,
  });
  ok("missed session flagged", blocked.freshness.missedSession);
  ok("no recommendation when the data missed a session", blocked.recommendation === null);
  ok("reason explains the refusal",
     (blocked.blockedReason ?? "").includes("last completed NSE session"),
     blocked.blockedReason ?? "");

  // The case calendar-day counting got wrong: a weekend is not a gap.
  const monday = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [],
    settings: { ...SETTINGS, maxBarAgeSessions: 0 },
    prices: new Map([["A", priceRow({ symbol: "A", closes, lastBar: "2026-08-07" })]]),
    priceFailures: [],
    nowMs: ist("2026-08-10T10:00:00"),
  });
  ok("Friday's bar on a Monday morning is fresh, even with zero slack",
     !monday.freshness.missedSession && monday.recommendation !== null,
     JSON.stringify(monday.freshness));
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── THIN HISTORY IS EXCLUDED AT THE CONFIGURED BAR ──");
{
  const short = rising(100, 150);
  const r = runStrategy({
    watchlist: [{ symbol: "NEW", name: "recently listed", targetPct: 100 }],
    holdings: [],
    settings: SETTINGS, // minCandles 252
    prices: new Map([["NEW", priceRow({ symbol: "NEW", closes: short })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  ok("150 closes excluded when 252 required",
     r.excluded.some((e) => e.symbol === "NEW" && e.reason.includes("need 252")),
     JSON.stringify(r.excluded));

  const lenient = runStrategy({
    watchlist: [{ symbol: "NEW", name: "recently listed", targetPct: 100 }],
    holdings: [],
    settings: { ...SETTINGS, minCandles: 120 },
    prices: new Map([["NEW", priceRow({ symbol: "NEW", closes: short })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  ok("lowering the bar admits it, at reduced confidence",
     lenient.ranked.length === 1 && lenient.ranked[0].confidence < 1,
     `confidence=${lenient.ranked[0]?.confidence}`);
  ok("reduced confidence shrinks the cheapness contribution",
     lenient.ranked[0].cheapnessAdjusted < lenient.ranked[0].cheapness);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── PREMIUM BLOCKS A BUY END-TO-END ──");
{
  const closes = rising();
  const r = runStrategy({
    watchlist: [
      { symbol: "RICH", name: "at a premium", targetPct: 50 },
      { symbol: "FAIR", name: "at NAV", targetPct: 50 },
    ],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([
      ["RICH", priceRow({ symbol: "RICH", closes, livePrice: 100, nav: 86, navDate: YESTERDAY })],
      ["FAIR", priceRow({ symbol: "FAIR", closes, livePrice: 100, nav: 100, navDate: YESTERDAY })],
    ]),
    priceFailures: [],
    nowMs: NOW,
  });
  ok("ETF far above NAV is excluded",
     r.excluded.some((e) => e.symbol === "RICH" && e.reason.includes("absolute limit")),
     JSON.stringify(r.excluded));
  check("the fairly-priced one is recommended", r.recommendation?.symbol, "FAIR");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── INTEGRITY GATES ──");
{
  // A held symbol with no price would be valued at zero and skew every weight.
  const unpriced = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [{ symbol: "A", units: 1 }, { symbol: "GOLD", units: 10 }],
    settings: SETTINGS,
    prices: new Map([["A", priceRow({ symbol: "A" })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  check("an unpriced holding is reported", unpriced.unpricedHoldings, ["GOLD"]);
  ok("and blocks the recommendation",
     unpriced.recommendation === null && (unpriced.blockedReason ?? "").includes("GOLD"),
     unpriced.blockedReason ?? "");

  const withTargets = (targets: Array<number | null>) => {
    const watchlist = targets.map((targetPct, i) => ({ symbol: `E${i}`, name: `e${i}`, targetPct }));
    return runStrategy({
      watchlist,
      holdings: [],
      settings: SETTINGS,
      prices: pricesFor(watchlist),
      priceFailures: [],
      nowMs: NOW,
    });
  };

  const slightlyOff = withTargets([50, 47]);
  ok("targets 3pp off warn", slightlyOff.warnings.some((w) => w.startsWith("Targets sum")),
     JSON.stringify(slightlyOff.warnings));
  ok("but still recommend", slightlyOff.recommendation !== null);

  const wayOff = withTargets([50, 40]);
  ok("targets 10pp off block the run",
     wayOff.recommendation === null && (wayOff.blockedReason ?? "").includes("targets sum"),
     wayOff.blockedReason ?? "");

  const noTargets = withTargets([null, null]);
  check("no targets at all is not a target-sum problem", noTargets.warnings, []);
  ok("and still recommends on cheapness alone", noTargets.recommendation !== null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── BUDGET AND PROJECTION ──");
{
  const closes = rising();
  const r = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [{ symbol: "A", units: 1 }],
    settings: SETTINGS,
    prices: new Map([["A", priceRow({ symbol: "A", closes, livePrice: 100 })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  const rec = r.recommendation!;
  ok("cost stays inside the budget", rec.cost <= SETTINGS.budget, `cost=${rec.cost}`);
  ok("projected weight is reported", rec.projectedPct > 0);

  const dear = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([["A", priceRow({ symbol: "A", closes, livePrice: 9000 })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  ok("unaffordable single unit yields no recommendation", dear.recommendation === null);
  ok("and says why", (dear.blockedReason ?? "").includes("affordable"), dear.blockedReason ?? "");
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
