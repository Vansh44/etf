"""
portfolio.py — WHAT YOU OWN, AND HOW MUCH YOU INVEST
====================================================
Three things you maintain by hand. Nothing else main.py reads needs editing.
This file is for main.py only — the web app keeps holdings in Supabase.

  UNITS           how many units of each ETF you hold
  BUDGET          rupees to spend per run
  MAX_WEIGHT_PCT  concentration cap — see below

UNITS drives two things in main.py:

  1. The portfolio value/weight table logged on every run.
  2. The concentration cap. An ETF already above MAX_WEIGHT_PCT of your
     portfolio is skipped and main.py moves to the next-cheapest candidate.
     The trend check already drops an ETF still sliding under both its
     averages; this cap is what stops main.py piling into one ETF that keeps
     scoring cheapest. (The web app replaces it with target allocations.)

IMPORTANT — list EVERY ETF you own, not just the ones on the watchlist.
Holdings outside the watchlist (gold, silver) still count toward your total
value. Leaving them out would understate the total, inflate every other ETF's
weight, and trip the cap far too early.

Fractional units are not possible on NSE, so these are whole numbers.
A watchlist symbol missing from here is treated as 0 units.

Update the count after a fill — main.py logs the exact new number to enter.
Last synced 2026-10-21 with the web app's Portfolio page.
"""

UNITS = {
    # ── on the watchlist (main.py can buy these) ──
    "MOMIDMTM":    45,
    "ALPHA":       10,
    "MODEFENCE":   39,
    "MAKEINDIA":   12,
    "BFSI":         0,
    "MON100":       7,
    "INFRAIETF":   30,

    # ── held but NOT on the watchlist: never bought, still counted in the
    #    portfolio total so the weights above stay honest ──
    "GOLDBEES":    92,
    "SILVERBEES":  20,
    "NIFTYBEES":   15,
    "JUNIORBEES":   2,
    "MIDCAPETF":  250,
    "MOSMALL250": 166,
}

# Rupees to spend each time you run main.py. Nothing tracks how often you run
# it — run it twice and it suggests spending this twice.
BUDGET = 2500.0

# Skip any ETF already above this share of portfolio value.
# With 7 watchlist ETFs equal weight would be ~14%. At 40% an ETF has to grow
# to roughly 3x its equal share before the cap steps in.
MAX_WEIGHT_PCT = 40.0
