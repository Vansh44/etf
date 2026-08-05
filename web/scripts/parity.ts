/**
 * Parity harness — verifies this TypeScript port against the Python script.
 *
 * Both sides are fed the SAME closes and live prices from a fixture file, so a
 * price tick between runs cannot look like a port bug.
 *
 *   python3 web/scripts/make_fixture.py     # from the repo root
 *   cd web && node --experimental-strip-types scripts/parity.ts scripts/fixture.json
 */
import { readFileSync } from "node:fs";
import { passesTrend, scoreCheapness, sizeOrder } from "../src/lib/strategy.ts";

type Fixture = Record<string, { closes: number[]; live: number }>;

const path = process.argv[2];
if (!path) {
  console.error("usage: parity.ts <fixture.json>");
  process.exit(1);
}

const fixture: Fixture = JSON.parse(readFileSync(path, "utf8"));
const round = (v: number | null) => (v === null ? null : Number(v.toFixed(6)));

const out: Record<string, unknown> = {};
for (const [symbol, { closes, live }] of Object.entries(fixture)) {
  const trend = passesTrend(closes, live);
  const score = scoreCheapness(closes, live);
  const order = sizeOrder(live, 2500, 0.2);
  out[symbol] = {
    keep: trend.keep,
    branch: trend.label,
    dma_long: round(trend.dmaLong),
    dma_short: round(trend.dmaShort),
    cheapness: round(score.cheapness),
    price_pctile: round(score.pricePctile),
    dd_now: round(score.ddNow),
    dd_pctile: round(score.ddPctile),
    qty: order.qty,
    limit_price: order.limitPrice,
  };
}

console.log(JSON.stringify(out, null, 1));
