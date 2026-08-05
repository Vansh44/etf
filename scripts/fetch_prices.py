#!/usr/bin/env python3
"""
fetch_prices.py — feeds the web app.

Reads the watchlist and holdings from Supabase, pulls a year of daily closes
plus the live price from Yahoo, and writes them back to the `prices` table.

WHY THIS EXISTS
Yahoo blocks requests whose TLS fingerprint isn't a real browser's — a plain
HTTP client gets HTTP 429 no matter what headers it sends. yfinance works
because it uses curl_cffi with impersonate="chrome". Vercel's Node runtime
can't do that, so the fetch happens here instead and the web app only ever
reads Supabase.

  pip install yfinance requests
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/fetch_prices.py

The service-role key bypasses Row Level Security, which is what lets this
write. Keep it in GitHub Secrets — never in the web app.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s  %(message)s")
log = logging.getLogger("fetch_prices")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""

HISTORY_PERIOD = "1y"
MIN_CANDLES = 100     # the web app needs this many to score an ETF


def die(message: str) -> None:
    log.error(message)
    sys.exit(1)


def rest(method: str, path: str, **kwargs) -> requests.Response:
    """Supabase REST call with the service-role key."""
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    headers.update(kwargs.pop("headers", {}))
    response = requests.request(
        method, f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, timeout=30, **kwargs
    )
    if not response.ok:
        die(f"Supabase {method} {path} failed: HTTP {response.status_code} {response.text[:300]}")
    return response


def symbols_to_fetch() -> list:
    """Watchlist plus everything held — held ETFs still need a price for weights."""
    watchlist = {row["symbol"] for row in rest("GET", "watchlist?select=symbol").json()}
    holdings = {row["symbol"] for row in rest("GET", "holdings?select=symbol").json()}
    return sorted(watchlist | holdings)


def main() -> None:
    if not SUPABASE_URL or not SERVICE_KEY:
        die("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

    import yfinance as yf  # imported late so the env check fails fast

    symbols = symbols_to_fetch()
    if not symbols:
        log.warning("Watchlist and holdings are both empty — nothing to fetch.")
        return
    log.info(f"Fetching {len(symbols)} symbols: {', '.join(symbols)}")

    # One batched request; yfinance handles the browser TLS impersonation.
    tickers = [f"{s}.NS" for s in symbols]
    frame = yf.download(
        tickers, period=HISTORY_PERIOD, interval="1d",
        auto_adjust=False, progress=False, group_by="column", threads=True,
    )
    if frame is None or frame.empty or "Close" not in frame:
        die("Yahoo returned no data at all. Try again later.")
    closes_frame = frame["Close"]

    rows, skipped = [], []
    now_iso = datetime.now(timezone.utc).isoformat()

    for symbol in symbols:
        ticker = f"{symbol}.NS"
        if ticker not in closes_frame:
            skipped.append(f"{symbol} (not found on Yahoo)")
            continue

        # Yahoo's newest bar is often a partial with a null close — drop nulls.
        series = closes_frame[ticker].dropna()
        if len(series) < MIN_CANDLES:
            skipped.append(f"{symbol} ({len(series)} closes, need {MIN_CANDLES})")
            continue

        # Live price where available, else the most recent close.
        live = None
        try:
            fast = yf.Ticker(ticker).fast_info
            candidate = fast.get("lastPrice")
            if candidate and float(candidate) > 0:
                live = float(candidate)
        except Exception as exc:
            log.warning(f"  {symbol}: live price unavailable ({exc}); using last close")
        if live is None:
            live = float(series.iloc[-1])

        rows.append({
            "symbol": symbol,
            "live_price": round(live, 4),
            "closes": [round(float(x), 4) for x in series],
            "last_bar": series.index[-1].date().isoformat(),
            "fetched_at": now_iso,
        })
        log.info(f"  {symbol:<12} {len(series):>3} closes | live {live:.2f}")

    if skipped:
        log.warning(f"Skipped: {'; '.join(skipped)}")

    if not rows:
        die("Nothing usable fetched — refusing to write. Leaving existing prices in place.")

    rest(
        "POST", "prices",
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        data=json.dumps(rows),
    )
    log.info(f"Wrote {len(rows)} rows to Supabase.")


if __name__ == "__main__":
    main()
