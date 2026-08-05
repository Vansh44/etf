"""
Writes fixture.json (shared inputs) and expected.json (the Python script's own
answers) so the TypeScript port can be diffed against main.py on identical data.

Run from the repo root:  python3 web/scripts/make_fixture.py
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
logging.disable(logging.CRITICAL)

import main                      # noqa: E402  the local Python advisor
from watchlist import ETF_WATCHLIST  # noqa: E402

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

symbols = list(ETF_WATCHLIST)
history = main.fetch_daily_closes(symbols)
last_closes = {s: float(v.iloc[-1]) for s, v in history.items()}
prices, _ = main.fetch_live_prices(symbols, last_closes)

fixture, expected = {}, {}
for symbol, closes in history.items():
    live = float(prices[symbol])
    fixture[symbol] = {"closes": [float(x) for x in closes], "live": live}

    keep, label, _ = main.passes_trend(closes, live)
    score = main.score_cheapness(closes, live)
    # Python reads LIMIT_BUFFER_PCT from module scope; assert it matches the
    # 0.20 the TS harness is told to use, or the comparison is meaningless.
    assert main.LIMIT_BUFFER_PCT == 0.20, main.LIMIT_BUFFER_PCT
    qty, limit_price, _ = main.suggest_order(live, 2500.0)

    expected[symbol] = {
        "keep": keep,
        "branch": label,
        "dma_long": round(float(closes.rolling(main.TREND_LONG).mean().iloc[-1]), 6),
        "dma_short": round(float(closes.rolling(main.TREND_SHORT).mean().iloc[-1]), 6),
        "cheapness": round(score["cheapness"], 6),
        "price_pctile": round(score["price_pctile"], 6),
        "dd_now": round(score["dd_now"], 6),
        "dd_pctile": round(score["dd_pctile"], 6),
        "qty": qty,
        "limit_price": limit_price,
    }

with open(os.path.join(OUT_DIR, "fixture.json"), "w") as fh:
    json.dump(fixture, fh)
with open(os.path.join(OUT_DIR, "expected.json"), "w") as fh:
    json.dump(expected, fh, indent=1)

print(f"wrote fixture.json ({len(fixture)} symbols) and expected.json")
