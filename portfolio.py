"""
portfolio.py — WHAT YOU OWN, AND HOW MUCH YOU INVEST
====================================================
Two things you maintain by hand. Nothing else in the system needs editing.

  UNITS   how many units of each ETF you hold
  BUDGET  rupees to spend per run

UNITS is for tracking only: main.py logs a value/weight table from it on every
run, and nothing more. It does not affect which ETF gets bought.

IMPORTANT — list EVERY ETF you own, not just the ones on the watchlist.
Holdings outside the watchlist (gold, silver) still count toward your total
value. Leaving them out would understate the total and inflate every other
ETF's weight in the table.

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
