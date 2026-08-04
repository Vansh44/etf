#!/usr/bin/env python3
"""
main.py — ETF BUY ADVISOR
========================
Tells you which ETF to buy and how many units. It places NO orders — you place
the trade yourself in the Groww app.

  1. Pulls a year of daily closes for every watchlist ETF.
  2. Scores each on RSI(3) against its own history.
  3. Prefers ETFs in an uptrend (above their 100-day average) and picks the most
     oversold of those — lowest RSI. If none are, it ranks the whole watchlist.
  4. Prints the pick, a suggested limit price, and how many units fit BUDGET.
  5. Logs a value/weight table of everything in portfolio.py so you can see
     where you stand. Those units do not affect the pick.

DATA SOURCE — Yahoo Finance, free, no API key, no account.
Validated against Groww's own live prices: for the 2026-06-08 session,
NIFTYBEES/JUNIORBEES/GOLDBEES/MON100 matched Groww to the paisa.
Prices come from 5-minute bars, which can lag the market by up to ~15 minutes,
so confirm the price in the Groww app before you place the order.

  watchlist.py   the ETFs you're interested in
  portfolio.py   units you own, budget

SETUP
  pip install yfinance pandas
  python main.py
"""

import logging
import datetime
import os
import time

import pandas as pd
import yfinance as yf

from watchlist import ETF_WATCHLIST
import portfolio


# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
LIMIT_BUFFER_PCT = 0.20    # suggested limit sits this % above the live price
NSE_TICK         = 0.01    # NSE cash-segment tick size
MIN_CANDLES      = 100     # the 100-day average needs at least this many
HISTORY_PERIOD   = "1y"    # how much daily history to pull

# A 5-minute bar wildly off the last daily close means a bad tick or a bad
# symbol, not a real move. Fall back to the daily close instead of trusting it.
MAX_LIVE_DEVIATION_PCT = 20.0

DOWNLOAD_RETRIES = 3
RETRY_WAIT_SEC   = 2

IST      = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE_DIR, "trades.log")

# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# yfinance logs its own raw HTTP errors (404s for typo'd symbols, etc.). We
# already report those in plain language, so keep its noise out of the log.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)


def yahoo(symbol: str) -> str:
    """NSE symbol -> Yahoo ticker. GOLDBEES -> GOLDBEES.NS"""
    return f"{symbol}.NS"

# ─────────────────────────────────────────────
#  DATA
# ─────────────────────────────────────────────
def _download(tickers: list, **kwargs):
    """
    One batched Yahoo request for all tickers, retried on failure.

    Batching matters: nine separate requests is nine chances to be rate-limited.
    Returns the 'Close' frame, or None if every attempt failed.
    """
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            raw = yf.download(tickers, auto_adjust=False, progress=False,
                              group_by="column", threads=True, **kwargs)
            if raw is not None and not raw.empty and "Close" in raw:
                return raw["Close"]
            log.warning(f"  ⚠ Empty response (attempt {attempt}/{DOWNLOAD_RETRIES}).")
        except Exception as e:
            log.warning(f"  ⚠ Download failed (attempt {attempt}/{DOWNLOAD_RETRIES}): {e}")
        if attempt < DOWNLOAD_RETRIES:
            time.sleep(RETRY_WAIT_SEC * attempt)
    return None


def fetch_daily_closes(symbols: list) -> dict:
    """{symbol: Series of clean daily closes}. Missing/short symbols are dropped."""
    closes = _download([yahoo(s) for s in symbols], period=HISTORY_PERIOD, interval="1d")
    if closes is None:
        return {}

    out = {}
    for symbol in symbols:
        ticker = yahoo(symbol)
        if ticker not in closes:
            log.warning(f"  ⚠ {symbol}: not found on Yahoo as {ticker}. Check the symbol.")
            continue
        # Yahoo's newest row is often a partial bar with no close — drop it.
        series = closes[ticker].dropna()
        if len(series) < MIN_CANDLES:
            log.warning(f"  ⚠ {symbol}: only {len(series)} daily closes, need {MIN_CANDLES}.")
            continue
        out[symbol] = series
    return out


def fetch_live_prices(symbols: list, last_closes: dict):
    """
    ({symbol: price}, as_of) using 5-minute bars, falling back to the last daily
    close per symbol. as_of is the newest intraday timestamp, or None.
    """
    intraday = _download([yahoo(s) for s in symbols], period="1d", interval="5m")
    prices, as_of = {}, None

    for symbol in symbols:
        reference = last_closes.get(symbol)
        live = None

        if intraday is not None and yahoo(symbol) in intraday:
            series = intraday[yahoo(symbol)].dropna()
            if len(series):
                live = float(series.iloc[-1])
                stamp = series.index[-1]
                if as_of is None or stamp > as_of:
                    as_of = stamp

        # Guard against a nonsense tick.
        if live is not None and reference:
            deviation = abs(live - reference) / reference * 100
            if deviation > MAX_LIVE_DEVIATION_PCT:
                log.warning(f"  ⚠ {symbol}: intraday Rs.{live:,.2f} is {deviation:.1f}% off the "
                            f"last close Rs.{reference:,.2f} — ignoring it, using the close.")
                live = None

        prices[symbol] = live if live is not None else float(reference or 0.0)

    return prices, as_of


def indicators(closes: pd.Series) -> dict:
    """RSI(3) plus the 50- and 100-day averages, from a series of daily closes."""
    delta    = closes.diff()
    gain     = delta.where(delta > 0, 0.0)
    loss     = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1/3, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/3, adjust=False).mean()
    rs  = avg_gain / avg_loss.replace(0, 1e-10)
    rsi = 100 - (100 / (1 + rs))

    return {
        "close":   float(closes.iloc[-1]),
        "dma50":   float(closes.rolling(50).mean().iloc[-1]),
        "dma100":  float(closes.rolling(100).mean().iloc[-1]),
        "rsi":     float(rsi.iloc[-1]),
        "day_pct": float(closes.pct_change().iloc[-1] * 100),
        "as_of":   closes.index[-1],
    }

# ─────────────────────────────────────────────
#  PORTFOLIO
# ─────────────────────────────────────────────
def portfolio_snapshot(prices: dict):
    """
    (total_value, rows) with units, price, value and weight per symbol.

    Everything in portfolio.UNITS counts toward the total, including holdings
    off the watchlist — leaving them out would overstate every other weight.
    Watchlist ETFs you don't own show at 0 so the table is complete.
    """
    rows, total = [], 0.0
    for symbol in sorted(set(portfolio.UNITS) | set(ETF_WATCHLIST)):
        units = int(portfolio.UNITS.get(symbol, 0) or 0)
        price = float(prices.get(symbol, 0.0) or 0.0)
        value = units * price
        total += value
        rows.append({"symbol": symbol, "units": units, "price": price, "value": value})

    for row in rows:
        row["weight"] = (row["value"] / total * 100) if total > 0 else 0.0

    rows.sort(key=lambda r: -r["value"])
    return total, rows


def log_portfolio(rows: list, total: float) -> None:
    log.info("  📦 PORTFOLIO")
    log.info(f"     {'ETF':<12}{'Units':>7}{'Price':>10}{'Value':>12}{'Weight':>9}")
    for row in rows:
        price = f"{row['price']:,.2f}" if row["price"] > 0 else "n/a"
        log.info(f"     {row['symbol']:<12}{row['units']:>7}{price:>10}"
                 f"{row['value']:>12,.0f}{row['weight']:>8.1f}%")
    log.info(f"     {'TOTAL':<12}{'':>7}{'':>10}{total:>12,.0f}")

# ─────────────────────────────────────────────
#  SIZING & SELECTION
# ─────────────────────────────────────────────
def suggest_order(live_price: float, budget: float):
    """(qty, limit_price, cost) that fits budget. qty 0 if one unit is too dear."""
    raw   = live_price * (1 + LIMIT_BUFFER_PCT / 100)
    limit = round(round(raw / NSE_TICK) * NSE_TICK, 2)
    if limit <= 0:
        return 0, 0.0, 0.0
    qty = int(budget // limit)
    return qty, limit, round(qty * limit, 2)


def rank_watchlist(history: dict):
    """(ranked, regime). Ranked best-first by RSI ascending."""
    uptrend, everything = [], []

    for symbol, name in ETF_WATCHLIST.items():
        if symbol not in history:
            continue
        ind = indicators(history[symbol])
        if pd.isna(ind["rsi"]) or pd.isna(ind["dma100"]):
            log.warning(f"  ⚠ {symbol}: indicators incomplete, skipping.")
            continue

        log.info(f"  📊 {symbol:<12} | Close: Rs.{ind['close']:>8.2f} "
                 f"| 50DMA: {ind['dma50']:>8.2f} | 100DMA: {ind['dma100']:>8.2f} "
                 f"| RSI: {ind['rsi']:>5.2f} | Day: {ind['day_pct']:>5.2f}%")

        entry = {"symbol": symbol, "name": name, **ind}
        everything.append(entry)
        if ind["close"] > ind["dma100"]:
            uptrend.append(entry)

    if not everything:
        return [], ""
    if uptrend:
        log.info("  📈 Uptrend regime — ranking ETFs above their 100-day average.")
        return sorted(uptrend, key=lambda e: e["rsi"]), "Uptrend"
    log.info("  🐻 Bear regime — nothing above its 100-day average, ranking the whole pool.")
    return sorted(everything, key=lambda e: e["rsi"]), "Bear market"

# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
def main() -> None:
    now = datetime.datetime.now(IST)
    log.info("=" * 72)
    log.info(f"  ETF Buy Advisor  |  {now:%Y-%m-%d %H:%M:%S} IST  |  data: Yahoo Finance")
    log.info("=" * 72)

    budget = float(portfolio.BUDGET)
    log.info(f"  💰 Budget Rs.{budget:,.2f}")

    # Price everything held as well, so the portfolio table is honest.
    all_symbols = sorted(set(ETF_WATCHLIST) | set(portfolio.UNITS))

    history = fetch_daily_closes(all_symbols)
    if not history:
        log.error("  🔴 Could not fetch any price history. Check your connection, "
                  "or Yahoo may be rate-limiting — try again in a minute.")
        return

    last_closes = {s: float(series.iloc[-1]) for s, series in history.items()}
    prices, as_of = fetch_live_prices(all_symbols, last_closes)

    if as_of is not None:
        log.info(f"  🕒 Live prices as of {as_of.tz_convert(IST):%Y-%m-%d %H:%M} IST "
                 f"(Yahoo 5-min bars, may lag ~15 min)")
    else:
        log.warning("  ⚠ No intraday data — using the last daily close for every price.")

    total, rows = portfolio_snapshot(prices)
    log_portfolio(rows, total)

    ranked, regime = rank_watchlist(history)
    if not ranked:
        log.error("  🔴 No watchlist ETF could be scored. Check the symbols in watchlist.py.")
        return

    pick = None
    for candidate in ranked:
        live = float(prices.get(candidate["symbol"], 0.0) or 0.0)
        if live <= 0:
            log.warning(f"  ⚠ {candidate['symbol']} skipped: no usable price.")
            continue
        qty, limit_price, cost = suggest_order(live, budget)
        if qty < 1:
            log.info(f"  ⏭  {candidate['symbol']} skipped: one unit costs "
                     f"Rs.{limit_price:,.2f}, over the Rs.{budget:,.2f} budget.")
            continue
        pick = {**candidate, "live": live, "qty": qty,
                "limit_price": limit_price, "cost": cost}
        break

    if pick is None:
        log.error(f"  🔴 Nothing affordable — one unit of every candidate costs more "
                  f"than Rs.{budget:,.2f}.")
        return

    log.info("-" * 72)
    log.info(f"  👉 BUY        : {pick['name']} ({pick['symbol']})")
    log.info(f"  Why          : lowest RSI(3) at {pick['rsi']:.2f} in the {regime} regime")
    log.info(f"  Live price   : Rs.{pick['live']:,.2f}")
    log.info(f"  Suggested    : {pick['qty']} units @ LIMIT Rs.{pick['limit_price']:,.2f} "
             f"= Rs.{pick['cost']:,.2f}  (price +{LIMIT_BUFFER_PCT:.2f}%)")
    log.info(f"  Left unspent : Rs.{budget - pick['cost']:,.2f}")
    log.info("-" * 72)
    log.info(f"  Place this yourself in the Groww app — confirm the live price there first.")
    log.info(f"  After it fills, set UNITS['{pick['symbol']}'] = "
             f"{int(portfolio.UNITS.get(pick['symbol'], 0) or 0) + pick['qty']} in portfolio.py")


if __name__ == "__main__":
    main()
