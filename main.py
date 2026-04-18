"""
====================================================================
  Mean-Reversion ETF Strategy  |  Groww Trading API
====================================================================
Strategy:
  - Run manually whenever you want to trade.
  - Finds the ETF with the lowest 5-day return across your watchlist.
  - Buys as many whole units as ₹500 allows (minimum 1 unit).
  - Logs the trade and updates a running balance.

Setup:
  pip install growwapi pyotp
====================================================================
"""

import os
import json
import logging
import datetime
import pyotp
from pathlib import Path
from growwapi import GrowwAPI
from dotenv import load_dotenv
load_dotenv()

# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────

TOTP_TOKEN  = os.getenv("GROWW_TOTP_TOKEN")
TOTP_SECRET = os.getenv("GROWW_TOTP_SECRET")

# TOTP_TOKEN  = "eyJraWQiOiJaTUtjVXciLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjI1NjQ4NzA5MTIsImlhdCI6MTc3NjQ3MDkxMiwibmJmIjoxNzc2NDcwOTEyLCJzdWIiOiJ7XCJ0b2tlblJlZklkXCI6XCJiMDJiODBlMC0xYjcxLTRmMDQtYWJhMy00MmMwZGIzZjFlYzRcIixcInZlbmRvckludGVncmF0aW9uS2V5XCI6XCJlMzFmZjIzYjA4NmI0MDZjODg3NGIyZjZkODQ5NTMxM1wiLFwidXNlckFjY291bnRJZFwiOlwiMTg4ZGUxZjUtMGU4NC00ODEyLTg4MDktMjVhYTIzZDFhNzZiXCIsXCJkZXZpY2VJZFwiOlwiZjBhMWIwYTEtOGRmNC01MTVjLWJmNDEtYTBjNTNiNmRhNzcwXCIsXCJzZXNzaW9uSWRcIjpcIjZiMDJiYzU0LTMyMzMtNDY0Mi05ZGM5LTQ0NDZjYzcxYzUwZVwiLFwiYWRkaXRpb25hbERhdGFcIjpcIno1NC9NZzltdjE2WXdmb0gvS0EwYklTcjNpS092M2krNm1JMUs1ekxteUpSTkczdTlLa2pWZDNoWjU1ZStNZERhWXBOVi9UOUxIRmtQejFFQisybTdRPT1cIixcInJvbGVcIjpcImF1dGgtdG90cFwiLFwic291cmNlSXBBZGRyZXNzXCI6XCIyNDA5OjQwOTA6ZDA0Nzo1YTAyOjUyOTo3MjE4OjFmZjI6YjQ4YSwxMDQuMjMuMjE2LjE2MCwzNS4yNDEuMjMuMTIzXCIsXCJ0d29GYUV4cGlyeVRzXCI6MjU2NDg3MDkxMjE4MyxcInZlbmRvck5hbWVcIjpcImdyb3d3QXBpXCJ9IiwiaXNzIjoiYXBleC1hdXRoLXByb2QtYXBwIn0.Zic98y54oKvbjWt3QtEGFe7EAGrxtcSAVRT6IT3S6-xLaH48wsB1cqMO8r_XSaSGBlGVrEdzZOZjyFT87N1aug"
# TOTP_SECRET = "GLGOFLMXOUBG3TLKKNXMHN5LSKAUFFDL"

DAILY_ALLOCATION = 500
LOG_FILE         = "etf_trades.log"
BALANCE_FILE     = "balance.json"
INITIAL_BALANCE  = 10_000   # Set this to your actual Groww account balance

ETF_WATCHLIST = {
    "INFRAIETF":   "ICICI Prudential Nifty Infrastructure ETF",
    "MODEFENCE":  "Motilal Oswal Nifty India Defence ETF",
    "MID150BEES":  "Nippon India ETF Nifty Midcap 150",
    "MAKEINDIA":    "Mirae Asset Nifty India Manufacturing ETF",
    "CONSUMBEES":  "Nippon India ETF Consumption",
    "MON100":        "Motilal Oswal NASDAQ 100 ETF",
}


# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
#  BALANCE
# ─────────────────────────────────────────────

def load_balance() -> float:
    if Path(BALANCE_FILE).exists():
        with open(BALANCE_FILE) as f:
            return json.load(f).get("balance", INITIAL_BALANCE)
    return INITIAL_BALANCE


def save_balance(balance: float) -> None:
    with open(BALANCE_FILE, "w") as f:
        json.dump(
            {"balance": balance, "updated": str(datetime.datetime.now())},
            f,
            indent=2,
        )


# ─────────────────────────────────────────────
#  AUTHENTICATION
# ─────────────────────────────────────────────

def fix_totp_secret(secret: str) -> str:
    """Clean and pad the TOTP secret for pyotp compatibility."""
    secret = secret.strip().upper().replace(" ", "")
    padding = len(secret) % 8
    if padding:
        secret += "=" * (8 - padding)
    return secret


def get_groww_client() -> GrowwAPI:
    totp = pyotp.TOTP(fix_totp_secret(TOTP_SECRET)).now()
    access_token = GrowwAPI.get_access_token(api_key=TOTP_TOKEN, totp=totp)
    log.info("Groww API authenticated successfully.")
    return GrowwAPI(access_token)


# ─────────────────────────────────────────────
#  PRICE HELPERS
# ─────────────────────────────────────────────

def get_current_price(groww: GrowwAPI, symbol: str) -> float | None:
    try:
        response = groww.get_ltp(
            segment=groww.SEGMENT_CASH,
            exchange_trading_symbols=f"NSE_{symbol}",
        )
        price = response.get(f"NSE_{symbol}")
        if price is None:
            log.warning(f"[{symbol}] LTP not found in response: {response}")
        return price
    except Exception as e:
        log.error(f"[{symbol}] Failed to fetch LTP: {e}")
        return None


def get_price_n_days_ago(groww: GrowwAPI, symbol: str, n_days: int = 5) -> float | None:
    try:
        end_dt   = datetime.datetime.now()
        start_dt = end_dt - datetime.timedelta(days=n_days * 3)  # buffer for weekends/holidays

        end_time   = end_dt.strftime("%Y-%m-%d %H:%M:%S")
        start_time = start_dt.strftime("%Y-%m-%d %H:%M:%S")

        response = groww.get_historical_candle_data(
            trading_symbol=symbol,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            start_time=start_time,
            end_time=end_time,
            interval_in_minutes=1440,  # daily candles
        )

        candles = response.get("candles", [])
        if len(candles) < n_days + 1:
            log.warning(f"[{symbol}] Not enough candle data ({len(candles)} candles).")
            return None

        sorted_candles = sorted(candles, key=lambda c: c[0])
        past_close = sorted_candles[-n_days][4]  # index 4 = close price
        return float(past_close)

    except Exception as e:
        log.error(f"[{symbol}] Failed to fetch historical data: {e}")
        return None


# ─────────────────────────────────────────────
#  STRATEGY LOGIC
# ─────────────────────────────────────────────

def calculate_return(current: float, past: float) -> float:
    return ((current - past) / past) * 100


def decide_units(price: float, allocation: float = DAILY_ALLOCATION) -> int:
    if price <= allocation:
        return int(allocation // price)
    return 1  # always buy at least 1 unit even if price > ₹500


def run_strategy() -> None:
    log.info("=" * 60)
    log.info(f"  ETF Strategy Run  |  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    balance = load_balance()
    log.info(f"Running balance before trade: ₹{balance:,.2f}")

    # ── Authenticate
    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"Authentication failed: {e}")
        return

    # ── Fetch prices and compute 5-day returns
    results = {}
    log.info("\n📊 Fetching prices for all ETFs...\n")

    for symbol, name in ETF_WATCHLIST.items():
        current_price = get_current_price(groww, symbol)
        past_price    = get_price_n_days_ago(groww, symbol, n_days=5)

        if current_price is None or past_price is None:
            log.warning(f"  ⚠  [{symbol}] Skipping — price data unavailable.")
            continue

        ret = calculate_return(current_price, past_price)
        results[symbol] = {
            "name":          name,
            "current_price": current_price,
            "past_price":    past_price,
            "return_pct":    ret,
        }
        log.info(
            f"  {symbol:<14}  Current: ₹{current_price:>8.2f}  |  "
            f"5d ago: ₹{past_price:>8.2f}  |  Return: {ret:>+7.2f}%"
        )

    if not results:
        log.error("No valid ETF data retrieved. Aborting.")
        return

    # ── Select ETF with lowest 5-day return
    selected_symbol = min(results, key=lambda s: results[s]["return_pct"])
    selected        = results[selected_symbol]
    price           = selected["current_price"]
    units           = decide_units(price)
    total_cost      = price * units

    log.info("\n" + "─" * 60)
    log.info(f"  ✅  Selected ETF : {selected['name']} ({selected_symbol})")
    log.info(f"      5-day return : {selected['return_pct']:+.2f}%  (lowest in watchlist)")
    log.info(f"      Price        : ₹{price:.2f}")
    log.info(f"      Units to buy : {units}")
    log.info(f"      Total cost   : ₹{total_cost:.2f}")
    log.info("─" * 60)

    # ── Place the order
    ref_id = f"ETF{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"  # 8–20 alphanumeric

    try:
        order_response = groww.place_order(
            trading_symbol=selected_symbol,
            quantity=units,
            validity=groww.VALIDITY_DAY,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            product=groww.PRODUCT_CNC,           # CNC = delivery holding
            order_type=groww.ORDER_TYPE_MARKET,  # market order for instant fill
            transaction_type=groww.TRANSACTION_TYPE_BUY,
            order_reference_id=ref_id,
        )

        order_id = order_response.get("groww_order_id", "N/A")
        status   = order_response.get("order_status", "N/A")

        log.info(f"\n  🟢 ORDER PLACED")
        log.info(f"     Groww Order ID : {order_id}")
        log.info(f"     Reference ID   : {ref_id}")
        log.info(f"     Status         : {status}")

        new_balance = balance - total_cost
        save_balance(new_balance)
        log.info(f"\n  💰 Balance : ₹{balance:,.2f}  →  ₹{new_balance:,.2f}  (spent ₹{total_cost:.2f})")

    except Exception as e:
        log.error(f"  🔴 Order placement FAILED: {e}")

    log.info("\n" + "=" * 60 + "\n")


# ─────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    run_strategy()