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

import base64
import json
import logging
import os
import sys
from datetime import datetime, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s  %(message)s")
log = logging.getLogger("fetch_prices")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# .strip() is load-bearing: pasting a value into GitHub's secret box easily
# captures a trailing newline, which then lands inside the request URL as %0A
# and fails DNS resolution with a baffling "Name or service not known".
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
SERVICE_KEY = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

HISTORY_PERIOD = "2y"   # the app scores against a 252-session window
MIN_CANDLES = 120       # floor for storing at all; the app enforces its own, higher, bar

# NAV, for the premium-over-underlying check.
# AMFI publishes daily NAV for every Indian fund but keys it on ISIN, not NSE
# ticker. Groww's public instrument master supplies ticker -> ISIN, so the two
# join cleanly with no fuzzy name matching.
INSTRUMENTS_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv"
AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"


def die(message: str) -> None:
    log.error(message)
    sys.exit(1)


def key_role(key: str):
    """
    Which Supabase role this key carries, or None if it can't be determined.

    Never logs or returns the key itself. Handles both the legacy JWT keys
    (role in the payload) and the newer sb_publishable_ / sb_secret_ format.
    """
    if key.startswith("sb_secret_"):
        return "service_role"
    if key.startswith("sb_publishable_"):
        return "anon"
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role")
    except Exception:
        return None


def check_credentials() -> None:
    """Fail early and specifically, rather than with an opaque RLS error later."""
    missing = [
        name
        for name, value in (("SUPABASE_URL", SUPABASE_URL),
                            ("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY))
        if not value
    ]
    if missing:
        die(
            f"Missing: {', '.join(missing)}. Add them under GitHub -> Settings -> "
            f"Secrets and variables -> Actions. SUPABASE_SERVICE_ROLE_KEY must be the "
            f"service_role key from Supabase -> Project Settings -> API, NOT the anon key."
        )

    if not SUPABASE_URL.startswith("https://"):
        die(
            f"SUPABASE_URL must start with https:// (got {SUPABASE_URL[:40]!r}). "
            f"Use the Project URL from Supabase -> Project Settings -> API, "
            f"e.g. https://yourref.supabase.co"
        )
    # Any whitespace left inside means the secret is malformed, not just padded.
    if any(c.isspace() for c in SUPABASE_URL):
        die(f"SUPABASE_URL contains whitespace inside the value: {SUPABASE_URL!r}")
    if any(c.isspace() for c in SERVICE_KEY):
        die("SUPABASE_SERVICE_ROLE_KEY contains whitespace — re-paste it with no line breaks.")

    role = key_role(SERVICE_KEY)
    if role == "anon":
        die(
            "SUPABASE_SERVICE_ROLE_KEY holds the ANON key, which is read-only under "
            "Row Level Security and cannot write prices. Replace it with the "
            "service_role key (Supabase -> Project Settings -> API -> service_role). "
            "Keep that key only in GitHub Secrets — never in Vercel or the web app."
        )
    if role != "service_role":
        log.warning(
            f"Could not confirm the key is a service_role key (role={role!r}). "
            f"Continuing; a 401/403 on write means it is the wrong key."
        )


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


def isin_map(symbols: list) -> dict:
    """{NSE symbol: ISIN} from Groww's public instrument master."""
    try:
        import csv
        import io

        response = requests.get(INSTRUMENTS_URL, timeout=60)
        response.raise_for_status()
        wanted = set(symbols)
        found = {}
        for row in csv.DictReader(io.StringIO(response.text)):
            if (
                row.get("exchange") == "NSE"
                and row.get("segment") == "CASH"
                and row.get("trading_symbol") in wanted
            ):
                isin = (row.get("isin") or "").strip()
                if isin:
                    found[row["trading_symbol"]] = isin
        log.info(f"  ISINs resolved: {len(found)}/{len(symbols)}")
        return found
    except Exception as exc:
        log.warning(f"  ⚠ Could not read the instrument master ({exc}); skipping NAV.")
        return {}


def nav_by_isin() -> dict:
    """
    {ISIN: (nav, iso_date)} from AMFI's daily NAV file.

    Note the redirect: the URL 302s, so redirects must be followed or you get a
    169-byte "Document Moved" page instead of 1.6 MB of NAVs.
    """
    try:
        response = requests.get(
            AMFI_NAV_URL,
            timeout=90,
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        response.raise_for_status()
        out = {}
        for line in response.text.splitlines():
            parts = line.split(";")
            if len(parts) < 6:
                continue
            try:
                nav = float(parts[4].strip())
            except ValueError:
                continue          # header rows and section headings
            if nav <= 0:
                continue
            iso = _amfi_date(parts[5].strip())
            # Both ISIN columns (growth / reinvestment) point at the same scheme.
            for isin in (parts[1].strip(), parts[2].strip()):
                if isin and isin != "-":
                    out[isin] = (nav, iso)
        log.info(f"  AMFI NAV rows indexed: {len(out)}")
        return out
    except Exception as exc:
        log.warning(f"  ⚠ Could not read AMFI NAVs ({exc}); prices will have no NAV.")
        return {}


def _amfi_date(raw: str):
    """'05-Aug-2026' -> '2026-08-05'. None if unparseable."""
    try:
        return datetime.strptime(raw, "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def main() -> None:
    check_credentials()

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

    # NAV lookup, for the premium-over-underlying check. Best-effort: if either
    # source is unavailable the prices still get written, just without NAV.
    isins = isin_map(symbols)
    navs = nav_by_isin() if isins else {}

    rows, skipped, no_nav = [], [], []
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

        nav_value, nav_date = navs.get(isins.get(symbol, ""), (None, None))
        if nav_value is None:
            no_nav.append(symbol)

        rows.append({
            "symbol": symbol,
            "live_price": round(live, 4),
            "closes": [round(float(x), 4) for x in series],
            "last_bar": series.index[-1].date().isoformat(),
            "nav": round(nav_value, 4) if nav_value is not None else None,
            "nav_date": nav_date,
            "fetched_at": now_iso,
        })

        premium = ""
        if nav_value:
            premium = f" | NAV {nav_value:.2f} ({(live - nav_value) / nav_value * 100:+.2f}%)"
        log.info(f"  {symbol:<12} {len(series):>3} closes | live {live:.2f}{premium}")

    if skipped:
        log.warning(f"Skipped: {'; '.join(skipped)}")
    if no_nav:
        log.warning(f"No NAV found for: {', '.join(no_nav)} — premium check will be skipped for these.")

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
