#!/usr/bin/env python3
"""
main.py — WEEKLY ETF BUY BOT
===========================
Run once a week, any trading day. Places at most ONE limit buy per calendar
week, then reports whether it actually filled.

WHAT IT DOES

  1. Refuses to run when the market is shut (weekend, NSE holiday, outside
     09:15-15:30 IST) or when this calendar week's buy is already done.
  2. Scores every watchlist ETF on RSI(3) from its own daily candles.
  3. Prefers ETFs in an uptrend — price above their 100-day average — and
     picks the most oversold of those (lowest RSI). If nothing is in an
     uptrend, it falls back to ranking the whole watchlist the same way.
  4. Walks that ranking, skipping anything already over MAX_WEIGHT_PCT of the
     portfolio or too expensive for the weekly budget, and buys the first
     candidate that passes both.
  5. Confirms the fill and logs the new unit count to put in portfolio.py.

WHAT YOU EDIT
  portfolio.py   units you own, weekly budget, concentration cap
  watchlist.py   which ETFs are allowed to be bought
  holidays.py    NSE holidays, one year at a time

ONE BUY PER WEEK is tracked in weekly_state.json next to this file. Delete
that file and the current week opens up again.

SETUP
  pip install growwapi pandas pyotp python-dotenv
  .env needs GROWW_TOTP_TOKEN and GROWW_TOTP_SECRET
  python main.py
"""

import json
import logging
import datetime
import pyotp
import pandas as pd
from growwapi import GrowwAPI
from growwapi.groww.exceptions import GrowwAPIAuthorisationException
import os
from holidays import NSE_MARKET_HOLIDAYS
from watchlist import ETF_WATCHLIST
import portfolio
import time
from dotenv import load_dotenv
load_dotenv()


# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
TOTP_TOKEN  = os.getenv("GROWW_TOTP_TOKEN")
TOTP_SECRET = os.getenv("GROWW_TOTP_SECRET")

LIMIT_BUFFER_PCT = 0.20    # buy limit sits this % above live LTP so it can fill
NSE_TICK         = 0.01    # NSE cash-segment tick size
MIN_CANDLES      = 100     # the 100-day average needs at least this many
HISTORY_DAYS     = 300     # calendar days of history to request (~205 sessions)

IST          = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
MARKET_OPEN  = datetime.time(9, 15)
MARKET_CLOSE = datetime.time(15, 30)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
LOG_FILE   = os.path.join(BASE_DIR, "trades.log")
STATE_FILE = os.path.join(BASE_DIR, "weekly_state.json")

# Groww's exact status vocabulary is not documented in the SDK, so classify
# generously and default to caution: anything not clearly a failure is treated
# as "this week is spoken for" rather than risk buying twice.
FILLED_STATUSES = {"EXECUTED", "COMPLETE", "COMPLETED", "FILLED"}
FAILED_STATUSES = {"REJECTED", "CANCELLED", "CANCELED", "FAILED", "EXPIRED", "LAPSED"}

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


class MarketDataForbidden(Exception):
    """
    The API key authenticates but is not entitled to market data (HTTP 403).

    Orders, holdings and margin keep working while quotes and historical
    candles are blocked, so this aborts the whole run instead of looking like
    one failure per symbol.
    """


def _is_forbidden(exc: Exception) -> bool:
    return (isinstance(exc, GrowwAPIAuthorisationException)
            or str(getattr(exc, "code", "")) == "403")


def _log_forbidden(exc: Exception) -> None:
    log.error(f"  🔴 FATAL: this API key is not entitled to market data (HTTP 403: {exc})")
    log.error("     Orders/holdings still work, but quotes and historical candles are blocked.")
    log.error("     Enable the market-data (Live Data) add-on for this key and check the")
    log.error("     IP allowlist in the Groww API dashboard. Aborting — no order placed.")

# ─────────────────────────────────────────────
#  AUTHENTICATION
# ─────────────────────────────────────────────
def fix_totp_secret(secret: str) -> str:
    secret = secret.strip().upper().replace(" ", "")
    padding = len(secret) % 8
    if padding:
        secret += "=" * (8 - padding)
    return secret


def get_groww_client() -> GrowwAPI:
    totp = pyotp.TOTP(fix_totp_secret(TOTP_SECRET)).now()
    access_token = GrowwAPI.get_access_token(api_key=TOTP_TOKEN, totp=totp)
    return GrowwAPI(access_token)

# ─────────────────────────────────────────────
#  ONE BUY PER CALENDAR WEEK
# ─────────────────────────────────────────────
def current_week(now: datetime.datetime) -> str:
    """ISO week label, e.g. '2026-W32'. Weeks run Monday to Sunday."""
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            return json.load(fh) or {}
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as e:
        log.warning(f"  ⚠ Could not read {os.path.basename(STATE_FILE)}: {e}. "
                    f"Treating this week as open.")
        return {}


def save_state(state: dict) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
    except OSError as e:
        log.error(f"  🔴 Could not write {os.path.basename(STATE_FILE)}: {e}. "
                  f"Next run may buy again this week!")


def week_already_spent(groww: GrowwAPI, state: dict, week: str):
    """
    Returns (spent, note).

    spent=True  -> this week's buy is done or still working; do not buy again.
    spent=False -> the week is open. note explains a retry when there was a
                   failed attempt earlier in the same week.
    """
    if not state or state.get("iso_week") != week:
        return False, ""

    label    = f"{state.get('symbol', '?')} on {state.get('date', '?')}"
    order_id = state.get("order_id")
    status   = str(state.get("status", "")).upper()
    filled   = state.get("filled_quantity")

    # The recorded status is a snapshot from placement time. Re-check it: an
    # order that was merely accepted then may have filled or expired since.
    if order_id and order_id != "N/A":
        try:
            detail = groww.get_order_status(
                segment=groww.SEGMENT_CASH,
                groww_order_id=order_id,
            ) or {}
            status = str(detail.get("order_status", status)).upper()
            filled = detail.get("filled_quantity", filled)
        except Exception as e:
            log.warning(f"  ⚠ Could not re-check order {order_id}: {e}")

    try:
        filled_qty = float(filled or 0)
    except (TypeError, ValueError):
        filled_qty = 0.0

    if filled_qty > 0 or status in FILLED_STATUSES:
        return True, f"bought {label}, filled {filled_qty:g}"
    if status in FAILED_STATUSES:
        return False, (f"earlier attempt this week ({label}) ended {status} "
                       f"without filling — trying again")
    return True, f"this week's order for {label} is {status or 'UNKNOWN'}"

# ─────────────────────────────────────────────
#  MARKET CALENDAR & CLOCK
# ─────────────────────────────────────────────
def market_closed_reason(now: datetime.datetime):
    """
    Returns a reason string if we must not trade right now, else None.

    Refuses outright when holidays.py has no entry for the current year — a
    stale calendar would otherwise pass silently on every holiday.
    """
    today = now.date()

    if today.weekday() >= 5:
        return "Weekend."

    covered_years = sorted({d[:4] for d in NSE_MARKET_HOLIDAYS})
    if str(today.year) not in covered_years:
        return (f"holidays.py has no {today.year} dates (it covers "
                f"{', '.join(covered_years)}). Refusing to trade against a "
                f"stale calendar — add this year's NSE holidays.")

    if today.strftime("%Y-%m-%d") in NSE_MARKET_HOLIDAYS:
        return "Public holiday."

    if not (MARKET_OPEN <= now.time() <= MARKET_CLOSE):
        return (f"Outside market hours — NSE cash trades "
                f"{MARKET_OPEN:%H:%M}-{MARKET_CLOSE:%H:%M} IST, it is now "
                f"{now:%H:%M} IST.")

    return None

# ─────────────────────────────────────────────
#  MARKET DATA
# ─────────────────────────────────────────────
def get_live_price(groww: GrowwAPI, symbol: str) -> float:
    """
    Live LTP for symbol, or 0.0 if unavailable.

    The limit price must come from here, not from the last daily candle: a buy
    limit pinned to a stale close sits below the market and never fills.
    """
    try:
        quote = groww.get_quote(
            trading_symbol=symbol,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
        ) or {}
    except Exception as e:
        if _is_forbidden(e):
            raise MarketDataForbidden(e) from e
        log.warning(f"  ⚠ Quote failed for {symbol}: {e}")
        return 0.0

    for key in ("last_price", "ltp", "last_traded_price", "close"):
        value = quote.get(key)
        if value:
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return 0.0


def fetch_prices(groww: GrowwAPI, symbols) -> dict:
    """Live price for each symbol. Needed for both sizing and portfolio weights."""
    return {sym: get_live_price(groww, sym) for sym in symbols}


def get_historical_dataframe(groww: GrowwAPI, symbol: str) -> pd.DataFrame:
    """Daily candles with RSI(3), 50-day and 100-day averages. Empty on failure."""
    try:
        end_dt   = datetime.datetime.now(IST)
        start_dt = end_dt - datetime.timedelta(days=HISTORY_DAYS)

        response = groww.get_historical_candle_data(
            trading_symbol=symbol,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            start_time=start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            end_time=end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            interval_in_minutes=1440,
        )

        candles = (response or {}).get("candles", [])
        if len(candles) < MIN_CANDLES:
            log.warning(f"  ⚠ Not enough data for {symbol} "
                        f"({len(candles)} candles, need {MIN_CANDLES}).")
            return pd.DataFrame()

        df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['close'] = df['close'].astype(float)
        df['daily_return'] = df['close'].pct_change() * 100
        df['50_DMA']  = df['close'].rolling(window=50).mean()
        df['100_DMA'] = df['close'].rolling(window=100).mean()

        delta    = df['close'].diff()
        gain     = delta.where(delta > 0, 0.0)
        loss     = -delta.where(delta < 0, 0.0)
        avg_gain = gain.ewm(alpha=1/3, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/3, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, 1e-10)
        df['RSI_3'] = 100 - (100 / (1 + rs))

        return df

    except Exception as e:
        # A 403 is an account-level entitlement failure, not thin history for
        # this one symbol — let it propagate so the run aborts immediately.
        if _is_forbidden(e):
            raise MarketDataForbidden(e) from e
        log.error(f"  🔴 Error fetching data for {symbol}: {e}")
        return pd.DataFrame()

# ─────────────────────────────────────────────
#  PORTFOLIO
# ─────────────────────────────────────────────
def portfolio_snapshot(prices: dict):
    """
    Returns (total_value, rows) where each row carries units, price, value and
    weight. Every symbol in portfolio.UNITS counts toward the total, including
    ones off the watchlist — otherwise weights would be overstated.
    """
    rows  = []
    total = 0.0
    # Union so the table always shows the full picture: everything you hold,
    # plus watchlist ETFs you don't own yet (0 units, 0% weight, still buyable).
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
    log.info(f"  📦 PORTFOLIO — cap {portfolio.MAX_WEIGHT_PCT:.0f}% per ETF")
    log.info(f"     {'ETF':<12}{'Units':>7}{'Price':>10}{'Value':>12}{'Weight':>9}")
    for row in rows:
        price = f"{row['price']:,.2f}" if row["price"] > 0 else "n/a"
        flag  = "  ⚠ over cap" if row["weight"] > portfolio.MAX_WEIGHT_PCT else ""
        log.info(f"     {row['symbol']:<12}{row['units']:>7}{price:>10}"
                 f"{row['value']:>12,.0f}{row['weight']:>8.1f}%{flag}")
    log.info(f"     {'TOTAL':<12}{'':>7}{'':>10}{total:>12,.0f}")

# ─────────────────────────────────────────────
#  ORDER SIZING & SELECTION
# ─────────────────────────────────────────────
def size_order(live_price: float, budget: float):
    """
    Returns (qty, limit_price, cost) for a buy that stays inside budget.

    qty is 0 when a single unit busts the budget — the caller must then move on
    rather than buying one unit anyway.
    """
    raw   = live_price * (1 + LIMIT_BUFFER_PCT / 100)
    limit = round(round(raw / NSE_TICK) * NSE_TICK, 2)
    if limit <= 0:
        return 0, 0.0, 0.0
    qty = int(budget // limit)
    return qty, limit, round(qty * limit, 2)


def pick_candidate(ranked: list, prices: dict, weights: dict, budget: float):
    """
    Walk the ranking best-first and return the first candidate that clears both
    the concentration cap and the weekly budget. None if nothing qualifies.

    The cap is tested on CURRENT weight, not post-buy weight: an ETF is skipped
    only once it has already grown past MAX_WEIGHT_PCT.
    """
    for candidate in ranked:
        symbol = candidate["symbol"]

        weight = weights.get(symbol, 0.0)
        if weight > portfolio.MAX_WEIGHT_PCT:
            log.info(f"  ⏭  {symbol} skipped: already {weight:.1f}% of the portfolio "
                     f"(cap {portfolio.MAX_WEIGHT_PCT:.0f}%).")
            continue

        live = float(prices.get(symbol, 0.0) or 0.0)
        if live <= 0:
            log.warning(f"  ⚠ {symbol} skipped: no live price available.")
            continue

        qty, limit_price, cost = size_order(live, budget)
        if qty < 1:
            log.info(f"  ⏭  {symbol} skipped: one unit costs Rs.{limit_price:.2f}, "
                     f"over the Rs.{budget:.2f} weekly budget.")
            continue

        return {**candidate, "live": live, "qty": qty,
                "limit_price": limit_price, "cost": cost, "weight": weight}
    return None

# ─────────────────────────────────────────────
#  STRATEGY
# ─────────────────────────────────────────────
def scan_watchlist(groww: GrowwAPI):
    """Returns (ranked, regime). ranked is empty when nothing could be scored."""
    valid_targets = []
    all_targets   = []

    for symbol, name in ETF_WATCHLIST.items():
        df = get_historical_dataframe(groww, symbol)
        if df.empty or pd.isna(df['RSI_3'].iloc[-1]):
            continue

        latest        = df.iloc[-1]
        current_price = latest['close']
        dma_50        = latest['50_DMA']
        dma_100       = latest['100_DMA']
        rsi_3         = latest['RSI_3']
        daily_return  = latest['daily_return']

        log.info(f"  📊 {symbol:<12} | P: Rs.{current_price:>8.2f} | 50DMA: {dma_50:>8.2f} "
                 f"| 100DMA: {dma_100:>8.2f} | RSI: {rsi_3:>5.2f} | Day: {daily_return:>5.2f}%")

        etf_data = {
            "symbol":       symbol,
            "name":         name,
            "price":        current_price,
            "rsi":          rsi_3,
            "daily_return": daily_return,
        }
        all_targets.append(etf_data)

        if current_price > dma_100:
            valid_targets.append(etf_data)

    if not all_targets:
        return [], ""

    if valid_targets:
        log.info("  📈 Uptrend regime — ranking ETFs trading above their 100-day average.")
        return sorted(valid_targets, key=lambda x: x['rsi']), "Uptrend"

    log.info("  🐻 Bear regime — nothing above its 100-day average, ranking the whole pool.")
    return sorted(all_targets, key=lambda x: x['rsi']), "Bear market"


def run_strategy() -> None:
    now  = datetime.datetime.now(IST)
    week = current_week(now)

    log.info("=" * 72)
    log.info(f"  Weekly ETF Buy  |  {now:%Y-%m-%d %H:%M:%S} IST  |  {week}")
    log.info("=" * 72)

    closed = market_closed_reason(now)
    if closed:
        log.info(f"  🛑 NOT TRADING. {closed}")
        return

    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"  🔴 Authentication failed: {e}")
        return

    # ── one buy per calendar week ──
    spent, note = week_already_spent(groww, load_state(), week)
    if spent:
        log.info(f"  🛑 ALREADY INVESTED IN {week} — {note}. Nothing to do.")
        return
    if note:
        log.info(f"  ↻ {note}.")

    # ── budget: the weekly figure, capped by cash actually settled ──
    try:
        margin     = groww.get_available_margin_details() or {}
        clear_cash = float(margin.get("clear_cash", 0.0) or 0.0)
    except Exception as e:
        log.error(f"  🔴 Could not read available margin: {e}")
        return

    budget = min(float(portfolio.WEEKLY_BUDGET), clear_cash)
    log.info(f"  💰 Weekly budget Rs.{portfolio.WEEKLY_BUDGET:,.2f} | "
             f"Clear cash Rs.{clear_cash:,.2f} | Spendable Rs.{budget:,.2f}")
    if budget < NSE_TICK:
        log.error("  🔴 No spendable cash in the account. Nothing to do.")
        return

    try:
        ranked, regime = scan_watchlist(groww)
        if not ranked:
            log.error("  🔴 No watchlist ETF had usable history. Check the symbols.")
            return

        # Price every held symbol too, so portfolio weights are honest.
        prices = fetch_prices(groww, sorted(set(ETF_WATCHLIST) | set(portfolio.UNITS)))
        total, rows = portfolio_snapshot(prices)
        log_portfolio(rows, total)

        weights = {row["symbol"]: row["weight"] for row in rows}
        pick = pick_candidate(ranked, prices, weights, budget)

    except MarketDataForbidden as e:
        _log_forbidden(e)
        return

    if pick is None:
        log.error(f"  🔴 Nothing qualified this week — every candidate was over the "
                  f"{portfolio.MAX_WEIGHT_PCT:.0f}% cap or over Rs.{budget:,.2f}. "
                  f"No order placed.")
        return

    qty, limit_price, total_cost = pick['qty'], pick['limit_price'], pick['cost']

    log.info("-" * 72)
    log.info(f"  TARGET      : {pick['name']} ({pick['symbol']})")
    log.info(f"  Why         : lowest RSI(3) at {pick['rsi']:.2f} in the {regime} regime, "
             f"currently {pick['weight']:.1f}% of portfolio")
    log.info(f"  Live LTP    : Rs.{pick['live']:,.2f}")
    log.info(f"  Order       : {qty} units @ Rs.{limit_price:,.2f} LIMIT = Rs.{total_cost:,.2f} "
             f"(LTP +{LIMIT_BUFFER_PCT:.2f}%)")
    log.info(f"  Left unspent: Rs.{budget - total_cost:,.2f}")
    log.info("-" * 72)

    try:
        order_response = groww.place_order(
            trading_symbol=pick['symbol'],
            quantity=qty,
            validity=groww.VALIDITY_DAY,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            product=groww.PRODUCT_CNC,
            order_type=groww.ORDER_TYPE_LIMIT,
            price=limit_price,
            transaction_type=groww.TRANSACTION_TYPE_BUY,
            order_reference_id=f"ETF{now.strftime('%Y%m%d%H%M%S')}"
        ) or {}
    except Exception as e:
        log.error(f"  🔴 Order placement FAILED: {e}")
        return

    order_id = order_response.get('groww_order_id', 'N/A')
    status   = order_response.get('order_status', 'UNKNOWN')
    log.info(f"  📨 Order ACCEPTED by Groww. ID: {order_id} | Status: {status} | Regime: {regime}")

    # Record the week immediately — before the fill check — so a crash here
    # cannot lead to a second buy in the same week.
    state = {
        "iso_week":    week,
        "date":        f"{now:%Y-%m-%d}",
        "symbol":      pick['symbol'],
        "qty":         qty,
        "limit_price": limit_price,
        "order_id":    order_id,
        "status":      status,
    }
    save_state(state)

    # Acceptance is not execution. A DAY-validity limit order that never trades
    # simply expires at close, so confirm what actually happened.
    final_status, filled = status, None
    if order_id != 'N/A':
        time.sleep(3)
        try:
            detail = groww.get_order_status(
                segment=groww.SEGMENT_CASH,
                groww_order_id=order_id,
            ) or {}
            final_status = detail.get('order_status', status)
            filled       = detail.get('filled_quantity')
        except Exception as e:
            log.warning(f"  ⚠ Could not confirm order status: {e}")

    state["status"] = final_status
    state["filled_quantity"] = filled
    save_state(state)

    if str(final_status).upper() in FILLED_STATUSES or (filled and float(filled) > 0):
        bought = int(float(filled)) if filled else qty
        log.info(f"  ✅ FILLED: {bought} units of {pick['symbol']} @ ~Rs.{limit_price:,.2f}")
        log.info(f"  ✏️  Update portfolio.py: UNITS['{pick['symbol']}'] = "
                 f"{int(portfolio.UNITS.get(pick['symbol'], 0) or 0) + bought}")
    else:
        log.warning(f"  ⏳ NOT FILLED YET — status: {final_status}"
                    f"{f', filled {filled}/{qty}' if filled is not None else ''}. "
                    f"A DAY limit order that never trades expires at "
                    f"{MARKET_CLOSE:%H:%M} IST.")
        log.warning(f"     If it expires unfilled, re-running this week will try again. "
                    f"Only update portfolio.py once it actually fills.")


if __name__ == "__main__":
    run_strategy()
