readme_content = """# 📈 Groww Cloud Quant: ETF Pullback Strategy

A fully automated, stateless quantitative trading algorithm built for **Groww Cloud**. This bot scans a curated watchlist of Indian ETFs, identifies the optimal daily target using a volatility-adjusted pullback strategy, and autonomously executes a limit order right before market close.

## 🧠 The Algorithm (Hybrid Strategy)
This bot operates on a **Multi-Tiered Selection System** to balance capital preservation with aggressive opportunity hunting. It runs daily at 3:00 PM IST.

### Tier 1: The Trend Filter (Alpha Seeking)
The algorithm calculates the 50-Day and 100-Day Simple Moving Averages (SMA) using pure Pandas math. It filters the watchlist to only include ETFs that are in a mathematically confirmed structural uptrend:
`Current Price > 50-DMA > 100-DMA`

From this list of healthy assets, it calculates the **3-Period Relative Strength Index (RSI)** and selects the ETF with the lowest RSI. *Goal: Buy the steepest short-term dip within a strong long-term macro trend.*

### Tier 2: The Fallback (Bear Market Regime)
If the broader market is crashing and *zero* ETFs pass the Tier 1 trend filter, the bot does not sit idle. It falls back to scanning the entire watchlist and selects the single most oversold asset based purely on RSI. *Goal: Ensure the daily capital allocation is always deployed at the most statistically favorable discount.*

## ⚡ Core Features
* **Stateless Execution:** No databases, no local ledger files. The bot calculates its purchasing power dynamically (`Daily Allocation // Price`) ensuring seamless operation on ephemeral cloud servers.
* **Smart Scheduling:** Includes a hardcoded `datetime` gatekeeper that automatically aborts execution on weekends (Saturdays/Sundays) and listed NSE holidays.
* **Native Math:** Stripped of heavy third-party technical analysis libraries. Uses lightning-fast native `pandas` matrix mathematics to calculate DMA and RSI.
* **TOTP Automation:** Bypasses the 6:00 AM daily API token reset by dynamically generating fresh Access Tokens using `pyotp` seconds before execution.
* **Email Telemetry:** Sends detailed trade execution reports directly to your inbox via SMTP.

## 🚀 Deployment Guide (Groww Cloud)

Because Groww Cloud uses ephemeral containers, this project is consolidated into a single `main.py` file.

### 1. Requirements Setup
In your Groww Strategy dashboard, ensure the **Requirements** tab includes:
```text
pandas
growwapi
pyotp
