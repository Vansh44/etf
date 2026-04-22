import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging
import datetime
import pyotp
import pandas as pd
from growwapi import GrowwAPI
import os
from holidays import NSE_MARKET_HOLIDAYS
from watchlist import ETF_WATCHLIST
from dotenv import load_dotenv
load_dotenv()


# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
TOTP_TOKEN  = os.getenv("GROWW_TOTP_TOKEN")
TOTP_SECRET = os.getenv("GROWW_TOTP_SECRET")
EMAIL_SENDER   = os.getenv("EMAIL_SENDER")      
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")    
EMAIL_RECEIVER = os.getenv("EMAIL_RECEIVER")
DAILY_ALLOCATION = 500.0  # Target spend per run

# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger(__name__)

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
#  API HELPERS & TECHNICAL ANALYSIS
# ─────────────────────────────────────────────
def get_historical_dataframe(groww: GrowwAPI, symbol: str) -> pd.DataFrame:
    """Fetches historical data and calculates indicators using pure Pandas."""
    try:
        end_dt   = datetime.datetime.now()
        start_dt = end_dt - datetime.timedelta(days=300) 

        response = groww.get_historical_candle_data(
            trading_symbol=symbol,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            start_time=start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            end_time=end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            interval_in_minutes=1440, 
        )

        candles = response.get("candles", [])
        if len(candles) < 100:
            log.warning(f"  ⚠ Not enough historical data for {symbol} to calculate 100-DMA.")
            return pd.DataFrame()

        df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['close'] = df['close'].astype(float)
        
        # ─────────────────────────────────────────────
        # NATIVE PANDAS INDICATOR CALCULATIONS
        # ─────────────────────────────────────────────
        # 1. Simple Moving Averages
        df['50_DMA'] = df['close'].rolling(window=50).mean()
        df['100_DMA'] = df['close'].rolling(window=100).mean()
        
        # 2. 3-Period RSI (Wilder's Smoothing)
        delta = df['close'].diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)
        
        # EMA for gains and losses using alpha = 1/period
        avg_gain = gain.ewm(alpha=1/3, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/3, adjust=False).mean()
        
        rs = avg_gain / avg_loss
        df['RSI_3'] = 100 - (100 / (1 + rs))
        # ─────────────────────────────────────────────
        
        return df

    except Exception as e:
        log.error(f"  🔴 Error fetching data for {symbol}: {e}")
        return pd.DataFrame()

# ─────────────────────────────────────────────
#  NOTIFICATIONS
# ─────────────────────────────────────────────
def send_trade_email(name: str, symbol: str, units: int, price: float, total_cost: float, order_id: str):
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        log.warning("  ⚠ Email credentials missing. Skipping email notification.")
        return

    subject = f"🟢 ETF Bot Trade: Bought {units}x {symbol}"
    body = (
        "Cloud automation successfully executed a trade.\n\n"
        f"Asset      : {name} ({symbol})\n"
        f"Units      : {units}\n"
        f"Limit Price: ₹{price:.2f}\n"
        f"Total Cost : ₹{total_cost:.2f}\n"
        f"Order ID   : {order_id}"
    )

    msg = MIMEMultipart()
    msg['From'] = EMAIL_SENDER
    msg['To'] = EMAIL_RECEIVER
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    try:
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
    log.info(f"  Quant Strategy Run (HYBRID)  |  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # --- HOLIDAY & WEEKEND GATEKEEPER ---
    today = datetime.date.today()
    if today.weekday() >= 5 or today.strftime("%Y-%m-%d") in NSE_MARKET_HOLIDAYS:
        log.info("  🛑 MARKET CLOSED. Skipping execution.")
        return

    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"Authentication failed: {e}")
        return

    log.info(f"  💰 Daily Target Allocation: ₹{DAILY_ALLOCATION:.2f}")

    valid_targets = []
    all_targets = []
    
    for symbol, name in ETF_WATCHLIST.items():
        df = get_historical_dataframe(groww, symbol)
        
        if df.empty or df['RSI_3'].isna().iloc[-1]:
            continue
            
        latest = df.iloc[-1]
        current_price = latest['close']
        dma_50 = latest['50_DMA']
        dma_100 = latest['100_DMA'] 
        rsi_3 = latest['RSI_3']

        log.info(f"  📊 {symbol:<12} | P: ₹{current_price:>7.2f} | 50DMA: {dma_50:>7.2f} | 100DMA: {dma_100:>7.2f} | RSI: {rsi_3:>5.2f}")

        # Store the ETF data once
        etf_data = {
            "symbol": symbol,
            "name": name,
            "price": current_price,
            "rsi": rsi_3
        }

        # 1. Always add to the master fallback list
        all_targets.append(etf_data)

        # 2. Add to the premium valid list ONLY if it passes the trend filter
        if current_price > dma_50 and dma_50 > dma_100:
            valid_targets.append(etf_data)

    if not all_targets:
        log.error("  🔴 Critical: No data found for any ETFs. Check API.")
        return

    # --- THE HYBRID SELECTION LOGIC ---
    if valid_targets:
        # Tier 1: Pick the most oversold ETF that is in a confirmed uptrend
        log.info("  📈 Found ETFs in an uptrend. Applying strict Trend Selection.")
        best_etf = sorted(valid_targets, key=lambda x: x['rsi'])[0]
    else:
        # Tier 2: Bear Market. Pick the most oversold ETF from the entire watchlist.
        log.info("  🐻 Bear Market Regime: No uptrends found. Applying Fallback Selection.")
        best_etf = sorted(all_targets, key=lambda x: x['rsi'])[0]
    
    # Execution Math
    qty = max(1, int(DAILY_ALLOCATION // best_etf['price']))
    limit_price = round(best_etf['price'] * 1.001, 2) 
    total_cost = round(qty * limit_price, 2)

    log.info("\n" + "─" * 60)
    log.info(f"  ✅ TARGET ACQUIRED : {best_etf['name']} ({best_etf['symbol']})")
    log.info(f"  📊 Lowest RSI(3)   : {best_etf['rsi']:.2f}")
    log.info(f"  🛒 Executing Order : {qty} units @ ₹{limit_price:.2f} LIMIT")
    log.info("─" * 60)

    try:
        order_response = groww.place_order(
            trading_symbol=best_etf['symbol'],
            quantity=qty,
            validity=groww.VALIDITY_DAY,
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            product=groww.PRODUCT_CNC,           
            order_type=groww.ORDER_TYPE_LIMIT,  
            price=limit_price,                  
            transaction_type=groww.TRANSACTION_TYPE_BUY,
            order_reference_id=f"ETF{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        )
        
        order_id = order_response.get('groww_order_id', 'N/A')
        status = order_response.get('order_status', 'N/A')
        log.info(f"  🟢 ORDER PLACED. Status: {status} | ID: {order_id}")

        if status.upper() in ["PLACED", "SUCCESS", "COMPLETED", "OPEN"]:
            send_trade_email(
                name=best_etf['name'], 
                symbol=best_etf['symbol'], 
                units=qty, 
                price=limit_price, 
                total_cost=total_cost, 
                order_id=order_id
            )

    except Exception as e:
        log.error(f"  🔴 Order placement FAILED: {e}")
        
    import time
    time.sleep(2)

if __name__ == "__main__":
    run_strategy()