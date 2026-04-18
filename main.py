import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
import logging
import datetime
import pyotp
import pandas as pd
from growwapi import GrowwAPI
import os


# ─────────────────────────────────────────────
#  LOCAL DATA CONSOLIDATION (Replaces separate files)
# ─────────────────────────────────────────────
ETF_WATCHLIST = {
    "MOMIDMTM":  "Motilal Oswal Nifty Midcap 150 Momentum 50 ETF",
    "ALPHA":      "Kotak Nifty Alpha 50 ETF",
    "MODEFENCE":   "Motilal Oswal Nifty India Defence ETF",
    "MAKEINDIA":  "Mirae Asset Nifty India Manufacturing ETF",
    "BFSI":   "Mirae Asset Nifty Financial Services ETF",
    "MON100":   "Motilal Oswal NASDAQ 100 ETF",
}

NSE_MARKET_HOLIDAYS = {
    "2026-01-15", # Maharashtra Municipal Elections
    "2026-01-26", # Republic Day
    "2026-03-03", # Holi
    "2026-03-26", # Shri Ram Navami
    "2026-03-31", # Shri Mahavir Jayanti
    "2026-04-03", # Good Friday
    "2026-04-14", # Dr. Baba Saheb Ambedkar Jayanti
    "2026-05-01", # Maharashtra Day
    "2026-05-28", # Bakri Id
    "2026-06-26", # Muharram
    "2026-09-14", # Ganesh Chaturthi
    "2026-10-02", # Mahatma Gandhi Jayanti
    "2026-10-20", # Dussehra
    "2026-11-10", # Diwali-Balipratipada
    "2026-11-24", # Prakash Gurpurb Sri Guru Nanak Dev
    "2026-12-25", # Christmas
}


# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
TOTP_TOKEN  = "eyJraWQiOiJaTUtjVXciLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjI1NjQ5MTI4NjYsImlhdCI6MTc3NjUxMjg2NiwibmJmIjoxNzc2NTEyODY2LCJzdWIiOiJ7XCJ0b2tlblJlZklkXCI6XCI0Y2E1YTRmMS04ZjQ2LTRlZWUtOTI1MC1kMjA3Mjk1OGNjOGRcIixcInZlbmRvckludGVncmF0aW9uS2V5XCI6XCJlMzFmZjIzYjA4NmI0MDZjODg3NGIyZjZkODQ5NTMxM1wiLFwidXNlckFjY291bnRJZFwiOlwiMTg4ZGUxZjUtMGU4NC00ODEyLTg4MDktMjVhYTIzZDFhNzZiXCIsXCJkZXZpY2VJZFwiOlwiZjBhMWIwYTEtOGRmNC01MTVjLWJmNDEtYTBjNTNiNmRhNzcwXCIsXCJzZXNzaW9uSWRcIjpcImE4MzI1MWUxLWY4YTAtNDFjMC1hY2RlLTk2Mjc1ZTJhNzc0MlwiLFwiYWRkaXRpb25hbERhdGFcIjpcIno1NC9NZzltdjE2WXdmb0gvS0EwYklTcjNpS092M2krNm1JMUs1ekxteUpSTkczdTlLa2pWZDNoWjU1ZStNZERhWXBOVi9UOUxIRmtQejFFQisybTdRPT1cIixcInJvbGVcIjpcImF1dGgtdG90cFwiLFwic291cmNlSXBBZGRyZXNzXCI6XCIyNDA5OjQwOTA6ZDA0Nzo1YTAyOmVkNTU6NGI1Njo2M2QyOmNhNTgsMTYyLjE1OC4yMjcuMTY2LDM1LjI0MS4yMy4xMjNcIixcInR3b0ZhRXhwaXJ5VHNcIjoyNTY0OTEyODY2ODU5LFwidmVuZG9yTmFtZVwiOlwiZ3Jvd3dBcGlcIn0iLCJpc3MiOiJhcGV4LWF1dGgtcHJvZC1hcHAifQ.t1yjZJCdrxrX27Qr15TXNqQprjA4DmcJyDEQuxZphjE_-xj5nyuAjP3WI5sRrB8CgZ9kEvLCeNpWS9nJiSb-ag"
TOTP_SECRET = "JNGRHSUI6FGAT3IMVKYR34F6JOAUO6TV"
EMAIL_SENDER   = "iamvanshgupta608@gmail.com"      
EMAIL_PASSWORD = "wtwzvwxncwlmfpiv"    
EMAIL_RECEIVER = "iamvanshgupta01@gmail.com"

DAILY_ALLOCATION = 500.0  # Target spend per run
LEDGER_FILE = "ledger.json"

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
    log.info(f"  Quant Strategy Run  |  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # --- HOLIDAY GATEKEEPER ---
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    if today_str in NSE_MARKET_HOLIDAYS:
        log.info(f"  🛑 MARKET CLOSED: Today ({today_str}) is a listed NSE holiday.")
        log.info("  Skipping script execution.")
        return  
    # --------------------------

    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"Authentication failed: {e}")
        return

    # 1. Stateless Daily Budget
    log.info(f"  💰 Daily Target Allocation: ₹{DAILY_ALLOCATION:.2f}")

    valid_targets = []
    
    for symbol, name in ETF_WATCHLIST.items():
        df = get_historical_dataframe(groww, symbol)
        
        if df.empty or df['RSI_3'].isna().iloc[-1]:
            continue
            
        latest = df.iloc[-1]
        current_price = latest['close']
        dma_50 = latest['50_DMA']
        dma_100 = latest['100_DMA'] # Using your updated 100-DMA logic
        rsi_3 = latest['RSI_3']

        log.info(f"  📊 {symbol:<12} | P: ₹{current_price:>7.2f} | 50DMA: {dma_50:>7.2f} | 100DMA: {dma_100:>7.2f} | RSI: {rsi_3:>5.2f}")

        # Trend Filter Condition
        if current_price > dma_50 and dma_50 > dma_100:
            valid_targets.append({
                "symbol": symbol,
                "name": name,
                "price": current_price,
                "rsi": rsi_3
            })

    # 2. Evaluate Market Regime (No Ledger Save needed)
    if not valid_targets:
        log.info("  🐻 Bear Market Regime: No ETFs met the trend criteria.")
        log.info("  🏁 Script finished successfully without buying.")
        return

    # 3. Select Target (Lowest RSI_3)
    best_etf = sorted(valid_targets, key=lambda x: x['rsi'])[0]
    
    # 4. NEW Execute Trade Rules (Stateless Quantity Logic)
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
        
    # Give cloud logs time to flush before shutdown
    import time
    time.sleep(2)

if __name__ == "__main__":
    run_strategy()