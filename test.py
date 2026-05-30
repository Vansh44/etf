import logging
import datetime
import pyotp
import pandas as pd
from growwapi import GrowwAPI
import os
from holidays import NSE_MARKET_HOLIDAYS
from watchlist import ETF_WATCHLIST
import time
from dotenv import load_dotenv
load_dotenv()


# ─────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────
TOTP_TOKEN  = os.getenv("GROWW_TOTP_TOKEN")
TOTP_SECRET = os.getenv("GROWW_TOTP_SECRET")
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
#  DATA & INDICATORS
# ─────────────────────────────────────────────
def get_historical_dataframe(groww: GrowwAPI, symbol: str) -> pd.DataFrame:
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
            log.warning(f"  ⚠ Not enough data for {symbol}.")
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
        log.error(f"  🔴 Error fetching data for {symbol}: {e}")
        return pd.DataFrame()

# ─────────────────────────────────────────────
#  STRATEGY LOGIC
# ─────────────────────────────────────────────
def run_strategy() -> None:
    log.info("=" * 60)
    log.info(f"  Quant Strategy Run (HYBRID)  |  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    today = datetime.date.today()
    if today.weekday() >= 5:
        log.info("  🛑 MARKET CLOSED. Weekend. Skipping execution.")
        return
    if today.strftime("%Y-%m-%d") in NSE_MARKET_HOLIDAYS:
        log.info("  🛑 MARKET CLOSED. Public holiday. Skipping execution.")
        return

    try:
        groww = get_groww_client()
    except Exception as e:
        log.error(f"Authentication failed: {e}")
        return

    log.info(f"  💰 Daily Target Allocation: Rs.{DAILY_ALLOCATION:.2f}")

    valid_targets = []
    all_targets   = []

    for symbol, name in ETF_WATCHLIST.items():
        df = get_historical_dataframe(groww, symbol)

        if df.empty or df['RSI_3'].isna().iloc[-1]:
            continue

        latest        = df.iloc[-1]
        current_price = latest['close']
        dma_50        = latest['50_DMA']
        dma_100       = latest['100_DMA']
        rsi_3         = latest['RSI_3']
        daily_return  = latest['daily_return']

        log.info(f"  📊 {symbol:<12} | P: Rs.{current_price:>7.2f} | 50DMA: {dma_50:>7.2f} | 100DMA: {dma_100:>7.2f} | RSI: {rsi_3:>5.2f} | Day Return: {daily_return:5.2f}%")

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
        log.error("  🔴 Critical: No data found for any ETFs. Check API.")
        return

    # --- NEW RANKING LOGIC ---
    def select_best_etf(etf_list):
        # 1. Rank by lowest daily return (0 is lowest return)
        etf_list.sort(key=lambda x: x['daily_return'])
        for rank, etf in enumerate(etf_list):
            etf['return_rank'] = rank
            
        # 2. Rank by lowest RSI (0 is lowest RSI)
        etf_list.sort(key=lambda x: x['rsi'])
        for rank, etf in enumerate(etf_list):
            etf['rsi_rank'] = rank
            
        # 3. Calculate combined score (50/50 weight means we just add the ranks together)
        for etf in etf_list:
            etf['combined_score'] = etf['return_rank'] + etf['rsi_rank']
            
        # 4. Sort by combined score (lowest score wins). If there is a tie, default to lowest RSI.
        etf_list.sort(key=lambda x: (x['combined_score'], x['rsi']))
        
        return etf_list[0]
    # -------------------------

    if valid_targets:
        log.info("  📈 Found ETFs in an uptrend. Applying Combined Ranking Criteria.")
        best_etf = select_best_etf(valid_targets)
        regime   = "Uptrend"
    else:
        log.info("  🐻 Bear Market Regime: No uptrends found. Applying Fallback Selection.")
        best_etf = select_best_etf(all_targets)
        regime   = "Bear market"

    qty         = max(1, int(DAILY_ALLOCATION // best_etf['price']))
    limit_price = round(best_etf['price'], 2)
    total_cost  = round(qty * limit_price, 2)

    log.info("\n" + "-" * 60)
    log.info(f"  TARGET ACQUIRED : {best_etf['name']} ({best_etf['symbol']})")
    log.info(f"  Lowest Return Rank : {best_etf['return_rank']} | Value: {best_etf['daily_return']:.2f}%")
    log.info(f"  Lowest RSI Rank    : {best_etf['rsi_rank']} | Value: {best_etf['rsi']:.2f}")
    log.info(f"  Combined Score     : {best_etf['combined_score']}")
    log.info(f"  Executing Order    : {qty} units @ Rs.{limit_price:.2f} LIMIT")
    log.info("-" * 60)

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
        status   = order_response.get('order_status', 'N/A')
        
        # Native logging takes the place of the email webhook
        log.info(f"  ✅ ORDER PLACED SUCCESSFULLY.")
        log.info(f"  Status: {status} | ID: {order_id} | Regime: {regime}")
        log.info(f"  Check the Groww app for final execution confirmation.")

    except Exception as e:
        log.error(f"  🔴 Order placement FAILED: {e}")

    time.sleep(2)

if __name__ == "__main__":
    run_strategy()