#!/usr/bin/env python3
"""
fetch_prices.py — feeds the web app.

Reads the watchlist and holdings from Supabase, pulls a year of daily closes
plus the live price from Yahoo, and writes them back to the `prices` table.

WHAT ELSE IT WRITES
  nav / nav_date        AMFI's end-of-day NAV, matched by ISIN
  inav / inav_at        NSE's intraday indicative NAV, when the run is inside
                        market hours — the reference the premium check prefers
  premium_history       one (close - nav) / nav observation per completed
                        session, oldest first, capped at a trading year. The
                        app ranks today's premium against this rather than
                        against a fixed threshold, because every ETF has its
                        own baseline.

Those three need the `prices` migration in web/supabase/schema.sql. Without it
the script still writes prices, and says so.

  python3 scripts/fetch_prices.py --backfill

seeds premium_history from AMFI's historical NAV report instead of waiting the
~3 months it takes to accumulate the 60 samples the app needs. One-off: it
downloads the whole market's NAVs a month at a time, so it does not belong in
the half-hourly job.

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
from datetime import datetime, timedelta, timezone

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

# Same data, arbitrary date range, for the one-off premium-history backfill.
# NOTE the column order differs from NAVAll.txt — see _parse_nav_history.
AMFI_NAV_HISTORY_URL = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx"

# iNAV: the intraday indicative NAV, recomputed through the session. This is
# the reference a premium check actually wants — AMFI's NAV is struck after the
# close, so by the time you trade on it the underlying has moved for hours.
NSE_ETF_URL = "https://www.nseindia.com/api/etf"
NSE_WARMUP_URL = "https://www.nseindia.com/market-data/exchange-traded-funds-etf"

IST = timezone(timedelta(hours=5, minutes=30))

# Trailing premium observations kept per symbol — one trading year, matching
# the window the app ranks today's premium against.
PREMIUM_HISTORY_MAX = 252
# How far back --backfill reaches. The app needs 60 samples before the
# percentile gate does anything; 200 calendar days is ~135 sessions, enough to
# clear that with room for holidays and the odd missing NAV.
BACKFILL_DAYS = 200
# One request per chunk; the whole-market file runs ~700 KB per day covered.
BACKFILL_CHUNK_DAYS = 30


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


def rest(method: str, path: str, allow_fail: bool = False, **kwargs):
    """
    Supabase REST call with the service-role key.

    Fatal by default: a failed write means the app would keep serving stale
    prices with nothing on screen to say so. `allow_fail` returns None instead,
    for the one case where failure is a diagnosis rather than an error —
    probing whether a migration has been applied.
    """
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
        if allow_fail:
            return None
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


def nse_inav(symbols: list) -> dict:
    """
    {NSE symbol: (inav, iso_timestamp)} from NSE's ETF board.

    WHY THIS BEATS THE EOD NAV
    AMFI's NAV is struck once, after the close. Judging a premium against it
    means judging today's price against yesterday's underlying — for MON100
    that is the Nasdaq's overnight move plus the rupee's, routinely more than
    the premium being measured. NSE recomputes an indicative NAV through the
    session, which is the like-for-like reference.

    The payload carries ONE `navDate` for the whole board. When it matches the
    date of the payload's own `timestamp`, these are today's live iNAVs. When
    it lags — any run outside market hours — the same field is just yesterday's
    EOD NAV, so it is dropped rather than passed off as intraday; the app then
    falls back to the AMFI NAV, which is what that number actually is.

    Best-effort throughout: NSE refuses plain HTTP clients (hence curl_cffi,
    already a dependency for Yahoo) and rejects some datacentre IPs outright.
    Nothing here is load-bearing — no iNAV simply means the EOD fallback.
    """
    try:
        from curl_cffi import requests as browser

        session = browser.Session(impersonate="chrome")
        # NSE hands out its cookies on a page view; the API 401s without them.
        session.get(NSE_WARMUP_URL, timeout=30)
        payload = session.get(NSE_ETF_URL, timeout=30).json()
    except Exception as exc:
        log.warning(f"  ⚠ Could not read NSE iNAVs ({exc}); falling back to EOD NAV.")
        return {}

    try:
        stamped = datetime.strptime(payload["timestamp"], "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
    except (KeyError, TypeError, ValueError):
        log.warning("  ⚠ NSE ETF board had no readable timestamp; skipping iNAV.")
        return {}

    nav_date = _amfi_date(str(payload.get("navDate", "")))
    if nav_date != stamped.date().isoformat():
        log.info(
            f"  NSE iNAV is dated {nav_date} against a board stamped "
            f"{stamped.date().isoformat()} — out of session, so it is yesterday's "
            f"EOD NAV. Using AMFI for the premium check instead."
        )
        return {}

    struck = stamped.astimezone(timezone.utc).isoformat()
    wanted = set(symbols)
    found = {}
    for row in payload.get("data", []):
        symbol = row.get("symbol")
        if symbol not in wanted:
            continue
        try:
            value = float(row.get("nav"))
        except (TypeError, ValueError):
            continue
        if value > 0:
            found[symbol] = (value, struck)

    log.info(f"  NSE iNAVs resolved: {len(found)}/{len(symbols)} (struck {stamped:%H:%M} IST)")
    return found


def stored_premium_history(symbols: list):
    """
    {symbol: (history, through_date)} already in the prices table.

    Returns None — distinct from an empty dict — when the columns do not exist,
    which is how the caller tells "nothing recorded yet" from "the migration
    has not been run", two situations that want very different handling.
    """
    response = rest(
        "GET",
        "prices?select=symbol,premium_history,premium_history_through",
        allow_fail=True,
    )
    if response is None:
        return None

    stored = {}
    wanted = set(symbols)
    for row in response.json():
        if row["symbol"] not in wanted:
            continue
        history = row.get("premium_history")
        stored[row["symbol"]] = (
            [float(x) for x in history] if isinstance(history, list) else [],
            row.get("premium_history_through"),
        )
    return stored


def _parse_nav_history(response, isin_to_symbol: dict) -> dict:
    """
    {symbol: {iso_date: nav}} from a streamed AMFI history report.

    Streamed and filtered line by line: the report covers every scheme in the
    country, so a month of it is ~20 MB of which a handful of rows matter.

    The column order is NOT the same as NAVAll.txt — this file leads with the
    scheme name, pushing both ISINs one place right and the date to the end:
      code ; name ; isin ; isin_reinv ; nav ; repurchase ; sale ; date
    """
    out = {}
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            continue
        parts = line.split(";")
        if len(parts) < 8:
            continue
        symbol = isin_to_symbol.get(parts[2].strip()) or isin_to_symbol.get(parts[3].strip())
        if symbol is None:
            continue
        try:
            nav = float(parts[4].strip())
        except ValueError:
            continue
        iso = _amfi_date(parts[7].strip())
        if nav > 0 and iso:
            out.setdefault(symbol, {})[iso] = nav
    return out


def nav_history(isins: dict, days: int) -> dict:
    """
    {symbol: {iso_date: nav}} over the last `days`, for the backfill.

    Requested in chunks because the report is served whole, uncompressed, for
    every scheme AMFI knows about. One request per month keeps each response
    to something a CI runner will not choke on.
    """
    isin_to_symbol = {isin: symbol for symbol, isin in isins.items()}
    if not isin_to_symbol:
        return {}

    today = datetime.now(IST).date()
    start = today - timedelta(days=days)
    merged = {}
    while start <= today:
        end = min(start + timedelta(days=BACKFILL_CHUNK_DAYS - 1), today)
        try:
            response = requests.get(
                AMFI_NAV_HISTORY_URL,
                params={"frmdt": f"{start:%d-%b-%Y}", "todt": f"{end:%d-%b-%Y}"},
                timeout=180,
                stream=True,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            for symbol, navs in _parse_nav_history(response, isin_to_symbol).items():
                merged.setdefault(symbol, {}).update(navs)
        except Exception as exc:
            log.warning(f"  ⚠ NAV history {start:%d-%b} to {end:%d-%b} unavailable ({exc}).")
        start = end + timedelta(days=1)

    log.info(f"  Backfill NAVs: {sum(len(v) for v in merged.values())} across {len(merged)} symbols")
    return merged


def append_todays_premium(history: list, through, nav_value, nav_date, closes_by_date: dict):
    """
    (history, through_date) with at most one observation added.

    Keyed on the NAV's own date, which makes the job safe to run every half
    hour: a session already recorded is never appended twice, and a NAV that
    lands a day late still pairs with the session it was struck for rather
    than with whatever the newest close happens to be.
    """
    if not nav_value or not nav_date or (through is not None and nav_date <= through):
        return history, through

    close_that_day = closes_by_date.get(nav_date)
    if not close_that_day:
        return history, through

    premium = round((close_that_day - nav_value) / nav_value * 100, 4)
    return (history + [premium])[-PREMIUM_HISTORY_MAX:], nav_date


def premiums_from_navs(navs: dict, closes_by_date: dict):
    """
    (history, through_date) — one observation per date where a NAV and that
    session's close both exist.

    Pairing on the DATE, not on "latest NAV against latest close", is what
    makes the series comparable to itself: MON100's NAV lands a day late, and
    matching it to the wrong session would write the day's index move into the
    premium series as if it were a premium.

    CAVEAT worth knowing before trusting the percentile. This series is built
    from the EOD NAV, because no historical iNAV is published anywhere. Today's
    premium is measured against the iNAV when the market is open, and for an
    ETF whose underlying trades overnight — MON100 — those two references sit
    at a systematically different level, so the percentile is comparing
    slightly unlike things. It is the absolute `max_premium_pct` cap, not the
    percentile, that does the real work for those ETFs.
    """
    dates = sorted(set(navs) & set(closes_by_date))[-PREMIUM_HISTORY_MAX:]
    history = [round((closes_by_date[d] - navs[d]) / navs[d] * 100, 4) for d in dates]
    return history, (dates[-1] if dates else None)


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
    inavs = nse_inav(symbols)

    # The premium series the app ranks today's premium against. None means the
    # columns are not there yet, in which case nothing premium-related is
    # written at all — a partial write would look like real data.
    stored = stored_premium_history(symbols)
    premium_columns = stored is not None
    if not premium_columns:
        log.warning(
            "prices.premium_history / inav are missing — run web/supabase/schema.sql "
            "in the Supabase SQL editor. Writing prices without them for now."
        )

    backfilling = premium_columns and (
        "--backfill" in sys.argv or os.getenv("BACKFILL_PREMIUM_HISTORY") == "1"
    )
    if backfilling:
        log.info(f"Backfilling premium history over the last {BACKFILL_DAYS} days.")
    backfill_navs = nav_history(isins, BACKFILL_DAYS) if backfilling else {}

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
        inav_value, inav_at = inavs.get(symbol, (None, None))

        row = {
            "symbol": symbol,
            "live_price": round(live, 4),
            "closes": [round(float(x), 4) for x in series],
            "last_bar": series.index[-1].date().isoformat(),
            "nav": round(nav_value, 4) if nav_value is not None else None,
            "nav_date": nav_date,
            "fetched_at": now_iso,
        }

        history_note = ""
        if premium_columns:
            closes_by_date = {ts.date().isoformat(): float(v) for ts, v in series.items()}
            history, through = stored.get(symbol, ([], None))

            # A backfill replaces rather than merges: it is the more complete
            # series by construction, and stitching two differently-derived
            # histories together would hide a gap in either.
            if symbol in backfill_navs:
                history, through = premiums_from_navs(backfill_navs[symbol], closes_by_date)

            history, through = append_todays_premium(
                history, through, nav_value, nav_date, closes_by_date
            )

            row["inav"] = round(inav_value, 4) if inav_value is not None else None
            row["inav_at"] = inav_at
            row["premium_history"] = history
            row["premium_history_through"] = through
            history_note = f" | history {len(history):>3}"

        rows.append(row)

        premium = ""
        reference, label = (
            (inav_value, "iNAV") if inav_value else (nav_value, "NAV")
        )
        if reference:
            premium = f" | {label} {reference:.2f} ({(live - reference) / reference * 100:+.2f}%)"
        log.info(f"  {symbol:<12} {len(series):>3} closes | live {live:.2f}{premium}{history_note}")

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
