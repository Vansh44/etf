"""
watchlist.py — THE POOL main.py IS ALLOWED TO BUY FROM
=====================================================
Every ETF listed here competes on each run; main.py picks at most one.
Add a line to widen the pool, delete one to drop it.

This file is for main.py only. The web app keeps its watchlist in Supabase and
edits it on its Watchlist page.

  key   = the NSE trading symbol, exactly as the exchange spells it
  value = a human-readable name, used only in the logs

A wrong symbol string makes the API call fail, so verify new entries on
nseindia.com first. All symbols below were checked against Groww's
instrument master on 2026-08-05.

Two rules worth knowing:

  * main.py needs 252 daily closes to score an ETF — a full year, because
    cheapness is ranked against the trailing year. Anything listed too
    recently is skipped with a warning.
  * Owning something is separate from wanting to buy it. Holdings you do
    NOT want topped up belong in portfolio.py UNITS but not here — they
    still count toward your portfolio total either way.
"""

ETF_WATCHLIST = {
    "MOMIDMTM":  "Motilal Oswal Nifty Midcap 150 Momentum 50 ETF",
    "ALPHA":     "Kotak Nifty Alpha 50 ETF",
    "MODEFENCE": "Motilal Oswal Nifty India Defence ETF",
    "MAKEINDIA": "Mirae Asset Nifty India Manufacturing ETF",
    "BFSI":      "Mirae Asset Nifty Financial Services ETF",
    "MON100":    "Motilal Oswal NASDAQ 100 ETF",
    "INFRAIETF": "ICICI Prudential Nifty Infrastructure ETF",
}
