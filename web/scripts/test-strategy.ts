/**
 * Tests for the scoring rules.
 *
 *   node --experimental-strip-types scripts/test-strategy.ts
 */
import {
  CHEAPNESS_LOOKBACK,
  CHEAPNESS_WEIGHT,
  GAP_WEIGHT,
  NEUTRAL_MARKS,
  lastCompletedSession,
  premiumOverFairValue,
  premiumVerdict,
  runStrategy,
  scaleMarks,
  scoreCheapness,
  sessionsBetween,
  sizeOrder,
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
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

// Spelled out rather than spread from DEFAULT_SETTINGS, so retuning a default
// never silently changes what these tests assert.
const SETTINGS: Settings = {
  budget: 2500,
  limitBufferPct: 0.2,
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

/** A flat series, so the 14-day average is exactly `level`. */
function flat(level = 100, n = 300): number[] {
  return Array.from({ length: n }, () => level);
}

function priceRow(over: Partial<PriceData> & { symbol: string }): PriceData {
  return {
    closes: flat(),
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

/** One fresh price row per watchlist entry, at its 14-day average. */
function pricesFor(watchlist: WatchlistItem[]): Map<string, PriceData> {
  return new Map(watchlist.map((w) => [w.symbol, priceRow({ symbol: w.symbol })]));
}

/** Score the way the strategy says it does, from the two marks. */
const combined = (cheap: number, gap: number) => CHEAPNESS_WEIGHT * cheap + GAP_WEIGHT * gap;

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n── CHEAPNESS VS THE ${CHEAPNESS_LOOKBACK}-DAY AVERAGE ──`);
{
  const below = scoreCheapness(flat(100), 95);
  check("average of a flat series is its level", below.recentAvg, 100);
  check("5% under the average reads +5 (cheap)", below.belowAvgPct, 5);
  check("5% over the average reads -5 (dear)", scoreCheapness(flat(100), 105).belowAvgPct, -5);

  // Exactly CHEAPNESS_LOOKBACK closes count — one older is out, the boundary is in.
  const outside = flat(100);
  outside[outside.length - CHEAPNESS_LOOKBACK - 1] = 200;
  check(`a spike ${CHEAPNESS_LOOKBACK + 1} sessions back is ignored`,
        scoreCheapness(outside, 100).belowAvgPct, 0);

  const inside = flat(100);
  inside[inside.length - CHEAPNESS_LOOKBACK] = 200;
  const avgWithSpike = (100 * (CHEAPNESS_LOOKBACK - 1) + 200) / CHEAPNESS_LOOKBACK;
  check(`a spike ${CHEAPNESS_LOOKBACK} sessions back is counted`,
        scoreCheapness(inside, 100).recentAvg, avgWithSpike);

  // During market hours the newest stored bar IS today; the live price replaces it.
  const withToday = [...flat(100), 500];
  check("today's own bar is left out of the average when flagged",
        scoreCheapness(withToday, 100, { lastCloseIsToday: true }).recentAvg, 100);
  ok("without the flag it would leak in",
     scoreCheapness(withToday, 100, { lastCloseIsToday: false }).recentAvg > 100);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── MARKS ARE SCALED 0-100 ACROSS THE FIELD ──");
{
  check("best gets 100, worst 0, the rest in proportion", scaleMarks([1, 2, 5]), [0, 25, 100]);
  check("negative values scale the same way", scaleMarks([-4, 0, 4]), [0, 50, 100]);
  check("all level -> everyone neutral", scaleMarks([3, 3, 3]),
        [NEUTRAL_MARKS, NEUTRAL_MARKS, NEUTRAL_MARKS]);
  check("a single candidate is neutral", scaleMarks([7]), [NEUTRAL_MARKS]);
  check("float noise is not stretched into a 0-100 spread",
        scaleMarks([0.1 + 0.2, 0.3]), [NEUTRAL_MARKS, NEUTRAL_MARKS]);
  check("no candidates, no marks", scaleMarks([]), []);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n── SCORE = ${CHEAPNESS_WEIGHT} x CHEAPNESS + ${GAP_WEIGHT} x ALLOCATION ──`);
{
  // A is 5% under its average, B 2%, C at it. Targets 40 / 30 / 30.
  const watchlist = [
    { symbol: "A", name: "a", targetPct: 40 },
    { symbol: "B", name: "b", targetPct: 30 },
    { symbol: "C", name: "c", targetPct: 30 },
  ];
  const prices = new Map<string, PriceData>([
    ["A", priceRow({ symbol: "A", livePrice: 95 })],
    ["B", priceRow({ symbol: "B", livePrice: 98 })],
    ["C", priceRow({ symbol: "C", livePrice: 100 })],
  ]);
  const run = (units: [number, number, number]) =>
    runStrategy({
      watchlist,
      holdings: [
        { symbol: "A", units: units[0] },
        { symbol: "B", units: units[1] },
        { symbol: "C", units: units[2] },
      ],
      settings: SETTINGS,
      prices,
      priceFailures: [],
      nowMs: NOW,
    });

  // Near target on A, B well under, C well over.
  const r = run([40, 10, 50]);
  const by = (s: string) => r.ranked.find((c) => c.symbol === s)!;
  check("deepest discount gets 100 cheapness marks", by("A").cheapnessMarks, 100);
  check("no discount gets 0", by("C").cheapnessMarks, 0);
  check("2% of a 0-5% spread gets 40", by("B").cheapnessMarks, 40, 1e-9);
  check("most underweight gets 100 allocation marks", by("B").gapMarks, 100);
  check("most overweight gets 0", by("C").gapMarks, 0);
  ok("every score is exactly the weighted sum of its two marks",
     r.ranked.every((c) => Math.abs(c.finalScore - combined(c.cheapnessMarks, c.gapMarks)) < 1e-9));
  check("ranked highest score first", r.ranked.map((c) => c.symbol), ["A", "B", "C"]);
  check("and the top one is recommended", r.recommendation?.symbol, "A");

  // Same prices, but now A — still the cheapest — is the most overweight.
  const heavy = run([60, 5, 35]);
  const hb = (s: string) => heavy.ranked.find((c) => c.symbol === s)!;
  check("the cheapest ETF gets 0 allocation marks when most overweight", hb("A").gapMarks, 0);
  check("so it scores only its cheapness half", hb("A").finalScore, combined(100, 0));
  check("and the underweight one wins instead", heavy.recommendation?.symbol, "B");
}

// No targets anywhere: every gap is 0, so cheapness alone decides.
{
  const watchlist = [
    { symbol: "DEEP", name: "deep dip", targetPct: null },
    { symbol: "MILD", name: "mild dip", targetPct: null },
  ];
  const r = runStrategy({
    watchlist,
    holdings: [],
    settings: SETTINGS,
    prices: new Map([
      ["DEEP", priceRow({ symbol: "DEEP", livePrice: 92 })],
      ["MILD", priceRow({ symbol: "MILD", livePrice: 99 })],
    ]),
    priceFailures: [],
    nowMs: NOW,
  });
  ok("with no targets every ETF gets neutral allocation marks",
     r.ranked.every((c) => c.gapMarks === NEUTRAL_MARKS));
  check("so the cheapest wins", r.recommendation?.symbol, "DEEP");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── NO TREND FILTER ──");
{
  // Falling steadily from 130 to 100, live under every average.
  const falling = Array.from({ length: 300 }, (_, i) => 130 - (30 * i) / 299);
  const r = runStrategy({
    watchlist: [{ symbol: "SLIDE", name: "still falling", targetPct: 100 }],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([["SLIDE", priceRow({ symbol: "SLIDE", closes: falling, livePrice: 99 })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  check("an ETF below its 50- and 14-day averages is still considered",
        r.recommendation?.symbol, "SLIDE");
  ok("and reads as cheap against its 14-day average", (r.ranked[0]?.belowAvgPct ?? 0) > 0);
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
  const run = (premiumSensitive: boolean, over: Partial<PriceData> = {}) =>
    runStrategy({
      watchlist: [{ symbol: "INTL", name: "international", targetPct: 100, premiumSensitive }],
      holdings: [],
      settings: SETTINGS,
      prices: new Map([["INTL", priceRow({ symbol: "INTL", ...over })]]),
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

  const eodOnly = run(true, { nav: 100, navDate: YESTERDAY });
  check("with an EOD NAV it is judged, not refused", eodOnly.recommendation?.symbol, "INTL");
  ok("but warns that the EOD NAV carries a day of drift",
     eodOnly.warnings.some((w) => w.startsWith("INTL:")),
     JSON.stringify(eodOnly.warnings));

  const withInav = run(true, { inav: 100, inavAt: new Date(NOW - 5 * 60_000).toISOString() });
  check("with a fresh iNAV there is nothing to warn about", withInav.warnings, []);
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
  // One symbol lags the newest session -> excluded, the fresh one survives.
  const prices = new Map<string, PriceData>([
    ["FRESH", priceRow({ symbol: "FRESH", lastBar: YESTERDAY })],
    ["LAGGY", priceRow({ symbol: "LAGGY", lastBar: "2026-07-28" })],
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
  const blocked = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([["A", priceRow({ symbol: "A", lastBar: "2026-07-20" })]]),
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
    prices: new Map([["A", priceRow({ symbol: "A", lastBar: "2026-08-07" })]]),
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
  const short = flat(100, 150);
  const run = (minCandles: number) =>
    runStrategy({
      watchlist: [{ symbol: "NEW", name: "recently listed", targetPct: 100 }],
      holdings: [],
      settings: { ...SETTINGS, minCandles },
      prices: new Map([["NEW", priceRow({ symbol: "NEW", closes: short })]]),
      priceFailures: [],
      nowMs: NOW,
    });
  ok("150 closes excluded when 252 required",
     run(252).excluded.some((e) => e.symbol === "NEW" && e.reason.includes("need 252")));
  check("lowering the bar admits it", run(120).recommendation?.symbol, "NEW");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── PREMIUM BLOCKS A BUY END-TO-END ──");
{
  const r = runStrategy({
    watchlist: [
      { symbol: "RICH", name: "at a premium", targetPct: 50 },
      { symbol: "FAIR", name: "at NAV", targetPct: 50 },
    ],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([
      // RICH is the deeper discount — it would win on marks if it got that far.
      ["RICH", priceRow({ symbol: "RICH", livePrice: 95, nav: 82, navDate: YESTERDAY })],
      ["FAIR", priceRow({ symbol: "FAIR", livePrice: 100, nav: 100, navDate: YESTERDAY })],
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
  ok("and still recommends", noTargets.recommendation !== null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── BUDGET, SIZING AND PROJECTION ──");
{
  const r = runStrategy({
    watchlist: [{ symbol: "A", name: "a", targetPct: 100 }],
    holdings: [{ symbol: "A", units: 1 }],
    settings: SETTINGS,
    prices: new Map([["A", priceRow({ symbol: "A" })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  const rec = r.recommendation!;
  check("limit price sits limitBufferPct above live", rec.limitPrice, 100.2);
  check("as many whole units as the budget allows", rec.qty, 24);
  ok("cost stays inside the budget", rec.cost <= SETTINGS.budget, `cost=${rec.cost}`);
  check("and is not flagged", rec.overBudget, false);
  check("leftover is what the budget did not use", rec.leftover, 95.2, 1e-9);
  ok("projected weight is reported", rec.projectedPct > 0);
}

// The case this rule exists for: one unit of the pick costs more than the budget.
{
  const r = runStrategy({
    watchlist: [{ symbol: "DEAR", name: "one unit over budget", targetPct: 100 }],
    holdings: [],
    settings: { ...SETTINGS, budget: 2000 },
    prices: new Map([["DEAR", priceRow({ symbol: "DEAR", closes: flat(2500), livePrice: 2500 })]]),
    priceFailures: [],
    nowMs: NOW,
  });
  const rec = r.recommendation;
  check("a pick costing ₹2,505 a unit on a ₹2,000 budget is still recommended", rec?.symbol, "DEAR");
  check("as the minimum of one unit", rec?.qty, 1);
  check("costing that one unit", rec?.cost, 2505);
  check("flagged as over budget", rec?.overBudget, true);
  check("with leftover showing how far over", rec?.leftover, -505, 1e-9);
  check("and nothing is excluded for it", r.excluded, []);
}

// The over-budget pick is not skipped in favour of an affordable runner-up.
{
  const r = runStrategy({
    watchlist: [
      { symbol: "PRICEY", name: "pricey", targetPct: 34 },
      { symbol: "B", name: "b", targetPct: 33 },
      { symbol: "C", name: "c", targetPct: 33 },
    ],
    holdings: [],
    settings: SETTINGS,
    prices: new Map([
      // 10% under its average and the biggest target: tops both marks.
      ["PRICEY", priceRow({ symbol: "PRICEY", closes: flat(10_000), livePrice: 9000 })],
      ["B", priceRow({ symbol: "B", livePrice: 98 })],
      ["C", priceRow({ symbol: "C", livePrice: 100 })],
    ]),
    priceFailures: [],
    nowMs: NOW,
  });
  check("an ETF over budget is still marked", r.ranked.find((c) => c.symbol === "PRICEY")?.cheapnessMarks, 100);
  check("and wins when it scores highest", r.recommendation?.symbol, "PRICEY");
  check("as one unit", r.recommendation?.qty, 1);
}

// The boundary: one unit exactly at the budget fits; one paisa under does not.
{
  check("one unit exactly at budget is not over", sizeOrder(100, 100.2, 0.2), {
    qty: 1, limitPrice: 100.2, cost: 100.2, overBudget: false,
  });
  check("a paisa short of one unit -> one unit, over budget", sizeOrder(100, 100.19, 0.2), {
    qty: 1, limitPrice: 100.2, cost: 100.2, overBudget: true,
  });
  check("room for more than one unit is never flagged", sizeOrder(100, 250, 0.2).overBudget, false);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
