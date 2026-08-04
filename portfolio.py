"""
portfolio.py — WHAT YOU OWN, AND HOW MUCH YOU INVEST
====================================================
Three things you maintain by hand. Nothing else in the system needs editing.

  UNITS           how many units of each ETF you hold
  BUDGET          rupees to spend per run
  MAX_WEIGHT_PCT  concentration cap — see below

UNITS drives two things in main.py:

  1. The portfolio value/weight table logged on every run.
  2. The concentration cap. An ETF already above MAX_WEIGHT_PCT of your
     portfolio value is skipped, and main.py moves to the next candidate,
     so no single holding can run away with the portfolio.

IMPORTANT — list EVERY ETF you own, not just the ones on the watchlist.
Holdings outside the watchlist (gold, silver) still count toward your total
value. Leaving them out would understate the total and inflate every other
ETF's weight, which would trip the cap far too early.

Fractional units are not possible on NSE, so these are whole numbers.
A watchlist symbol missing from here is treated as 0 units.

Update the count after a fill — main.py logs the exact new number to enter.
Seeded 2026-08-05 from the live Groww holdings endpoint.
"""

UNITS = {
    # ── on the watchlist (main.py can buy these) ──
    "MOMIDMTM":   45,
    "ALPHA":      10,
    "MODEFENCE":  39,
    "MAKEINDIA":  12,
    "BFSI":        0,
    "MON100":      1,
    "INFRAIETF":  30,

    # ── held but NOT on the watchlist: never bought, still counted in the
    #    portfolio total so the weights above stay honest ──
    "GOLDBEES":   92,
    "SILVERBEES": 20,
}

# Rupees to spend each time you run main.py, capped by the cash actually
# settled in your account. Nothing tracks how often you run it — run it twice
# and it spends this twice.
BUDGET = 2500.0

# Skip any ETF already above this share of portfolio value.
# With 7 watchlist ETFs, equal weight would be ~14%; 40% leaves room to let
# a winner run while still stopping true runaway concentration.
MAX_WEIGHT_PCT = 40.0
