#!/usr/bin/env python3
"""
main.py — CHEAPEST-ETF BUY ADVISOR
=================================
Tells you which ETF is cheapest right now and how many units to buy. It places
NO orders — you place the trade yourself in the Groww app.

  1. Pulls a year of daily closes for every watchlist ETF.
  2. TREND CHECK — decides which ETFs are eligible at all:
       above its 50-day average                  -> keep
       below the 50-day, but above the 14-day     -> keep (dip that is turning up)
       below BOTH the 50-day and the 14-day       -> discard (still falling)
  3. Scores the survivors on CHEAPNESS, 0-100, higher = cheaper. Ranks
     cheapest first.
  4. Skips any ETF already over MAX_WEIGHT_PCT of your portfolio or too
     expensive for BUDGET, and recommends the first that fits.
  5. Prints a suggested limit price and how many units fit BUDGET, plus a
     value/weight table of everything in portfolio.py.

HOW CHEAPNESS IS MEASURED
Each ETF is scored against ITS OWN history, never against the other ETFs. That
matters: a 5% dip is routine for MON100 (median dip 4.0%) but extreme for
MAKEINDIA (median 1.7%), so ranking on raw drawdown would just pick the
twitchiest ETF every week. Two components, both percentiles, both 0-100:

  A. PRICE POSITION — where the live price sits inside its own trailing 1-year
     range of closes. 0 = at its 52-week low.
     Cheapness contribution = 100 - price_percentile

  B. DIP UNUSUALNESS — today's drawdown from its 50-day high, ranked against
     its own past year of drawdowns. 90 means "deeper than 90% of the dips
     this ETF normally has."
     Cheapness contribution = drawdown_percentile

  cheapness = (A + B) / 2

A score of 75 means the same thing for gold as for small-caps.

Cheapness decides the ORDER; the trend check decides who is in the race at all.
An ETF sliding under both its averages is dropped no matter how cheap it looks,
so a steadily-falling ETF cannot sit at rank 1 week after week.

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
MIN_CANDLES      = 100     # below this an ETF cannot be scored
HISTORY_PERIOD   = "1y"    # how much daily history to pull

PRICE_WINDOW    = 252      # trailing sessions for the price-position percentile
HIGH_LOOKBACK   = 50       # sessions for the "recent high" used in the drawdown
MIN_DD_HISTORY  = 20       # fewer drawdown samples than this -> score it neutral

TREND_LONG      = 50       # first trend test: the 50-day average
TREND_SHORT     = 14       # second chance: the 14-day average

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


def passes_trend(closes: pd.Series, live_price: float):
    """
    (keep, label, detail) — is this ETF eligible to be ranked at all?

      above the 50-day average                 -> keep
      below the 50-day, above the 14-day       -> keep, the dip is turning up
      below both                               -> discard, still falling

    Which reduces to: discard only when the price is under BOTH averages.
    """
    dma_long  = closes.rolling(TREND_LONG).mean().iloc[-1]
    dma_short = closes.rolling(TREND_SHORT).mean().iloc[-1]

    if pd.isna(dma_long) or pd.isna(dma_short):
        return False, "no data", "not enough history for the moving averages"

    if live_price > dma_long:
        return True, f">{TREND_LONG}D", (f"Rs.{live_price:,.2f} above its {TREND_LONG}-day "
                                        f"avg Rs.{dma_long:,.2f}")
    if live_price > dma_short:
        return True, f">{TREND_SHORT}D", (f"Rs.{live_price:,.2f} under its {TREND_LONG}-day avg "
                                         f"Rs.{dma_long:,.2f} but above its {TREND_SHORT}-day "
                                         f"avg Rs.{dma_short:,.2f} — turning up")
    return False, "below both", (f"Rs.{live_price:,.2f} under both its {TREND_LONG}-day avg "
                                 f"Rs.{dma_long:,.2f} and {TREND_SHORT}-day avg "
                                 f"Rs.{dma_short:,.2f} — still falling")


def score_cheapness(closes: pd.Series, live_price: float) -> dict:
    """
    Cheapness 0-100, higher = cheaper. See the module docstring for the method.

    Scored against this ETF's own history so a volatile ETF and a steady one are
    directly comparable.
    """
    n      = len(closes)
    window = min(PRICE_WINDOW, n)
    look   = min(HIGH_LOOKBACK, n)

    # ── A. where does the live price sit in its own trailing range? ──
    recent       = closes.tail(window)
    price_pctile = float((recent < live_price).sum()) / len(recent) * 100

    # ── B. how unusual is today's dip for this ETF? ──
    recent_high = max(float(closes.tail(look).max()), live_price)  # live can be a new high
    dd_now      = (recent_high - live_price) / recent_high * 100 if recent_high > 0 else 0.0

    roll_high = closes.rolling(look).max()
    dd_hist   = ((roll_high - closes) / roll_high * 100).dropna().tail(window)
    if len(dd_hist) >= MIN_DD_HISTORY:
        dd_pctile = float((dd_hist < dd_now).sum()) / len(dd_hist) * 100
    else:
        dd_pctile = 50.0     # no baseline to judge against, stay neutral

    return {
        "cheapness":    ((100.0 - price_pctile) + dd_pctile) / 2,
        "price_pctile": price_pctile,
        "dd_now":       dd_now,
        "dd_pctile":    dd_pctile,
        "close":        float(closes.iloc[-1]),
        "day_pct":      float(closes.pct_change().iloc[-1] * 100),
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


def rank_by_cheapness(history: dict, prices: dict) -> list:
    """
    Watchlist ETFs that pass the trend check, cheapest first.

    The trend check runs FIRST, so an ETF under both its averages is out of the
    running however cheap it scores.
    """
    scored, discarded = [], []

    for symbol, name in ETF_WATCHLIST.items():
        if symbol not in history:
            continue
        live = float(prices.get(symbol, 0.0) or 0.0)
        if live <= 0:
            log.warning(f"  ⚠ {symbol}: no usable price, skipping.")
            continue

        keep, label, detail = passes_trend(history[symbol], live)
        if not keep:
            discarded.append((symbol, detail))
            continue

        result = score_cheapness(history[symbol], live)
        if pd.isna(result["cheapness"]):
            log.warning(f"  ⚠ {symbol}: could not be scored, skipping.")
            continue
        scored.append({"symbol": symbol, "name": name, "live": live,
                       "trend": label, "trend_detail": detail, **result})

    if discarded:
        log.info("  🚫 DISCARDED — under both moving averages, still falling:")
        for symbol, detail in discarded:
            log.info(f"     {symbol:<12} {detail}")

    scored.sort(key=lambda e: -e["cheapness"])

    if scored:
        log.info("  📉 CHEAPNESS — each ETF vs its OWN history, higher = cheaper")
        log.info(f"     {'#':<3}{'ETF':<12}{'Score':>7}{'in own range':>14}"
                 f"{'dip now':>9}{'dip vs own':>12}{'trend':>12}")
        for i, e in enumerate(scored, 1):
            log.info(f"     {i:<3}{e['symbol']:<12}{e['cheapness']:>7.1f}"
                     f"{e['price_pctile']:>13.0f}%{e['dd_now']:>8.1f}%"
                     f"{e['dd_pctile']:>11.0f}%{e['trend']:>12}")
        log.info("     in own range = price position in its 1-yr range (low = cheap)")
        log.info("     dip vs own   = how unusual today's dip is for it (high = cheap)")
        log.info(f"     trend        = which test kept it in (>{TREND_LONG}D or >{TREND_SHORT}D)")

    return scored

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
    weights = {row["symbol"]: row["weight"] for row in rows}

    ranked = rank_by_cheapness(history, prices)
    if not ranked:
        log.error("  🔴 Nothing eligible — every watchlist ETF is under both its 50-day "
                  "and 14-day averages. Buy nothing this round.")
        return

    pick = None
    for candidate in ranked:
        symbol = candidate["symbol"]

        weight = weights.get(symbol, 0.0)
        if weight > portfolio.MAX_WEIGHT_PCT:
            log.info(f"  ⏭  {symbol} skipped: already {weight:.1f}% of the portfolio "
                     f"(cap {portfolio.MAX_WEIGHT_PCT:.0f}%).")
            continue

        qty, limit_price, cost = suggest_order(candidate["live"], budget)
        if qty < 1:
            log.info(f"  ⏭  {symbol} skipped: one unit costs "
                     f"Rs.{limit_price:,.2f}, over the Rs.{budget:,.2f} budget.")
            continue

        pick = {**candidate, "qty": qty, "limit_price": limit_price,
                "cost": cost, "weight": weight}
        break

    if pick is None:
        log.error(f"  🔴 Nothing qualified — every candidate was over the "
                  f"{portfolio.MAX_WEIGHT_PCT:.0f}% cap or over Rs.{budget:,.2f}.")
        return

    log.info("-" * 72)
    log.info(f"  👉 BUY        : {pick['name']} ({pick['symbol']})")
    log.info(f"  Cheapness    : {pick['cheapness']:.1f}/100 — "
             f"{pick['dd_now']:.1f}% off its {HIGH_LOOKBACK}-day high, deeper than "
             f"{pick['dd_pctile']:.0f}% of its own dips, sitting at the "
             f"{pick['price_pctile']:.0f}th percentile of its 1-year range")
    log.info(f"  Trend        : {pick['trend_detail']}")
    log.info(f"  Portfolio    : currently {pick['weight']:.1f}% of your holdings "
             f"(cap {portfolio.MAX_WEIGHT_PCT:.0f}%)")
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
