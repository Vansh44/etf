# ETF Advisor

Tells you which ETF on your watchlist is the best buy right now and how many
units fit your budget. **It places no orders** — you place the trade yourself
in the Groww app.

Earlier versions of this repo were a Groww Cloud bot that placed orders on its
own. That code is gone; nothing here trades.

## What's here

| Path | What it is |
| --- | --- |
| `web/` | **The advisor.** A Next.js app on Vercel, backed by Supabase, behind Google sign-in and an email allowlist. All scoring lives in `web/src/lib/strategy.ts`. Start with [web/README.md](web/README.md). |
| `scripts/fetch_prices.py` | The price fetcher. Reads the watchlist and holdings from Supabase, pulls daily closes and live prices from Yahoo, end-of-day NAVs from AMFI and intraday iNAVs from NSE, and writes them to the `prices` table. |
| `.github/workflows/fetch-prices.yml` | Runs the fetcher every 30 minutes during NSE hours and once after the close. It runs in GitHub Actions because Yahoo blocks requests that don't look like a real browser, which Vercel can't fake. |
| `main.py`, `watchlist.py`, `portfolio.py` | The original standalone command-line advisor. It reads its own two config files rather than Supabase, and it lacks target allocations, the premium-over-NAV check and the stale-data refusal — see [The local Python script has diverged](web/README.md#the-local-python-script-has-diverged). |
| `trades.log` | What `main.py` writes as it runs. |

## Running it

The web app: follow [Setup](web/README.md#setup) in `web/README.md`.

The command-line advisor: put your ETFs in `watchlist.py` and your units and
budget in `portfolio.py`, then

```bash
pip install yfinance pandas
python3 main.py
```

This tool reports numbers. It is not financial advice.
