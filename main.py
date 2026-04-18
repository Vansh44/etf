import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import logging
import datetime
import pyotp
from growwapi import GrowwAPI
from dotenv import load_dotenv
from watchlist import ETF_WATCHLIST
from holidays import NSE_MARKET_HOLIDAYS

load_dotenv()

# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
TOTP_TOKEN  = os.getenv("GROWW_TOTP_TOKEN")
TOTP_SECRET = os.getenv("GROWW_TOTP_SECRET")
EMAIL_SENDER   = os.getenv("EMAIL_SENDER")      # e.g., yourbot@gmail.com
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")    # The 16-character App Password
EMAIL_RECEIVER = os.getenv("EMAIL_RECEIVER")

DAILY_ALLOCATION = 500  # Target spend per run



# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[logging.StreamHandler()] # Removed file handler for simplicity, add back if needed
)
log = logging.getLogger(__name__)

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
    return GrowwAPI(access_token)

# ─────────────────────────────────────────────
#  API HELPERS
# ─────────────────────────────────────────────
def get_current_price(groww: GrowwAPI, symbol: str) -> float | None:
    try:
        response = groww.get_ltp(
            segment=groww.SEGMENT_CASH,
            exchange_trading_symbols=f"NSE_{symbol}",
        )
        return response.get(f"NSE_{symbol}")
    except Exception as e:
        return None

def get_price_n_days_ago(groww: GrowwAPI, symbol: str, n_days: int = 5) -> float | None:
    try:
        end_dt   = datetime.datetime.now()
        start_dt = end_dt - datetime.timedelta(days=n_days * 3) 

        response = groww.get_historical_candle_data(
            trading_symbol=symbol,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            start_time=start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            end_time=end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            interval_in_minutes=1440, 
        )

        candles = response.get("candles", [])
        if len(candles) < n_days + 1:
            return None

        sorted_candles = sorted(candles, key=lambda c: c[0])
        return float(sorted_candles[-n_days][4]) 

    except Exception as e:
        return None



# ─────────────────────────────────────────────
#  NOTIFICATIONS
# ─────────────────────────────────────────────
def send_trade_email(name: str, symbol: str, units: int, price: float, total_cost: float, order_id: str):
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        log.warning("  ⚠ Email credentials missing. Skipping email notification.")
        return

    subject = f"🟢 ETF Bot Trade: Bought {units}x {symbol}"
    body = f"""
    Your automated trading bot has successfully executed a trade.

    Trade Details:
    -------------------------------
    Asset      : {name} ({symbol})
    Units      : {units}
    Price      : ₹{price:.2f}
    Total Cost : ₹{total_cost:.2f}
    Order ID   : {order_id}
    -------------------------------
    Strategy   : 5-Day Mean Reversion
    """

    msg = MIMEMultipart()
    msg['From'] = EMAIL_SENDER
    msg['To'] = EMAIL_RECEIVER
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    try:
        # Standard Gmail SMTP settings
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        log.info("  📧 Email notification sent successfully.")
    except Exception as e:
        log.error(f"  🔴 Failed to send email: {e}")

# ─────────────────────────────────────────────
#  STRATEGY LOGIC
# ─────────────────────────────────────────────
def run_strategy() -> None:
    log.info("=" * 60)
    log.info(f"  ETF Strategy Run  |  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # --- HOLIDAY GATEKEEPER ---
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    
    if today_str in NSE_MARKET_HOLIDAYS:
        log.info(f"  🛑 MARKET CLOSED: Today ({today_str}) is a listed NSE holiday.")
        log.info("  Skipping script execution.")
        return  # Exits the script immediately
    # --------------------------

    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"Authentication failed: {e}")
        return

    # 1. Fetch live balance from Groww
    try:
        # Note: The exact method name depends on your specific growwapi wrapper version.
        # It is usually get_balance() or retrieved via a profile endpoint.
        # If your wrapper lacks this method, the broker will simply reject the order natively if funds are low.
        balance_data = groww.get_balance() 
        live_balance = float(balance_data.get('available_balance', 0))
        log.info(f"💰 Live Available Balance: ₹{live_balance:,.2f}")
    except AttributeError:
        log.warning("Could not fetch live balance automatically. Relying on broker margin checks.")
        live_balance = float('inf') # Bypass check and let broker reject if insufficient

    # 2. Fetch prices and compute returns
    results = {}
    for symbol, name in ETF_WATCHLIST.items():
        current_price = get_current_price(groww, symbol)
        past_price    = get_price_n_days_ago(groww, symbol, n_days=5)

        if current_price and past_price:
            ret = ((current_price - past_price) / past_price) * 100
            results[symbol] = {
                "name": name, "current_price": current_price, "return_pct": ret
            }
            log.info(f"  {symbol:<14}  Current: ₹{current_price:>8.2f}  |  Return: {ret:>+7.2f}%")

    if not results:
        log.error("No valid ETF data retrieved. Aborting.")
        return

    # 3. Select ETF and calculate units
    selected_symbol = min(results, key=lambda s: results[s]["return_pct"])
    selected        = results[selected_symbol]
    price           = selected["current_price"]
    
    # Calculate units (buy at least 1 if price > allocation, otherwise max units for allocation)
    units = int(DAILY_ALLOCATION // price) if price <= DAILY_ALLOCATION else 1
    total_cost = price * units

    log.info("\n" + "─" * 60)
    log.info(f"  ✅ Selected : {selected['name']} ({selected_symbol})")
    log.info(f"      Total cost: ₹{total_cost:.2f} for {units} units")
    log.info("─" * 60)

    # 4. Final Balance Check
    if total_cost > live_balance:
        log.error(f"  🔴 Insufficient funds. Need ₹{total_cost:.2f}, but only have ₹{live_balance:.2f}.")
        return

    # 5. Place Order
    try:
        order_response = groww.place_order(
            trading_symbol=selected_symbol,
            quantity=units,
            validity=groww.VALIDITY_DAY,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            product=groww.PRODUCT_CNC,           
            order_type=groww.ORDER_TYPE_MARKET,  
            transaction_type=groww.TRANSACTION_TYPE_BUY,
            order_reference_id=f"ETF{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        )
        
        order_id = order_response.get('groww_order_id', 'N/A')
        status = order_response.get('order_status', 'N/A')
        log.info(f"  🟢 ORDER PLACED. Status: {status} | ID: {order_id}")

        # Trigger the email alert
        if status.upper() in ["PLACED", "SUCCESS", "COMPLETED"]:
            send_trade_email(
                name=selected['name'], 
                symbol=selected_symbol, 
                units=units, 
                price=price, 
                total_cost=total_cost, 
                order_id=order_id
            )

    except Exception as e:
        log.error(f"  🔴 Order placement FAILED: {e}")

if __name__ == "__main__":
    run_strategy()