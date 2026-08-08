# ETF Advisor — web app

Hosted version of the local Python advisor. Tells you which watchlist ETF is
cheapest right now and how many units fit your budget. **It places no orders** —
you place the trade yourself in the Groww app.

- **Data**: Yahoo Finance prices + AMFI NAVs, fetched by a scheduled GitHub Action into Supabase
- **Backend**: Supabase Postgres
- **Auth**: Google sign-in, restricted to an email allowlist
- **Host**: Vercel

All scoring lives in `src/lib/strategy.ts`. The repo-root `main.py` is an older,
reduced version of the same idea — see
[The local Python script has diverged](#the-local-python-script-has-diverged).

## How the data gets in

```
GitHub Action (cron)  ──yfinance──>  Yahoo      closes + live price
        │             ──AMFI─────>  NAVAll.txt  end-of-day NAV, by ISIN
        │             ──NSE──────>  /api/etf    intraday iNAV, in session only
        │
        └── writes ──>  Supabase `prices`
                              │
                Vercel app ───┘  (reads only)
```

Each run also appends one `(close - nav) / nav` observation per completed
session to `premium_history`, which is what the app ranks today's premium
against — a fixed threshold cannot be right for both NIFTYBEES and a capped
international ETF. That series takes ~60 sessions to become usable, or one
hand-triggered run of the Action with **backfill** ticked, which seeds it from
AMFI's historical NAV report.

**The web app never calls Yahoo.** It can't: Yahoo refuses any request whose TLS
fingerprint isn't a real browser's. Verified with an identical URL and
User-Agent at the same instant —

| client | result |
| --- | --- |
| plain HTTP (what Node `fetch` sends) | **HTTP 429** |
| `curl_cffi` with `impersonate="chrome"` | **HTTP 200**, data returned |

Node on Vercel cannot impersonate a browser's TLS handshake, so the fetch runs
in GitHub Actions using Python + yfinance (which uses `curl_cffi` internally)
and writes results to Supabase. This also means pages are fast and can never be
rate-limited.

---

## The strategy

```
1. FRESHNESS   refuse everything if prices missed a trading session;
               exclude any symbol whose bar lags the newest one
2. HISTORY     need `min_candles` sessions (default 252). Below the 252-session
               scoring window, cheapness is discounted for confidence
3. TREND       above the 50-day avg        -> keep
               below 50-day, above 14-day   -> keep (dip turning up)
               below BOTH                   -> discard, still falling
4. PREMIUM     market price too far above NAV -> discard
5. SCORE       final = cheapness x confidence + gap_weight x allocation_gap
6. BUDGET      skip anything one unit of which busts the budget
7. RECOMMEND   the highest-scoring candidate that fits
```

**Cheapness decides when to buy; the allocation gap decides what to buy.**

There is no hard concentration cap. An ETF above its target earns a *negative*
gap, which lowers its score, instead of being blocked outright.

### Cheapness (0–100)

Measured against each ETF's **own** history, never against the other ETFs, so a
volatile ETF and a steady one are comparable. Scale-invariant — the rupee price
level carries no information.

- **A** — where the live price sits in its own trailing 1-year range of closes
  (0 = at its 52-week low) → contributes `100 − percentile`
- **B** — today's drawdown from its 50-day high, ranked against its own past
  year of drawdowns → contributes that percentile
- `cheapness = (A + B) / 2`

Both drawdown windows are exactly `HIGH_LOOKBACK` observations wide: history
uses `closes[i-look+1 .. i]`, and today uses `look − 1` prior closes plus the
live price. Getting this wrong gives today a window one observation too wide,
which makes today's dip look systematically deeper than the history it is
ranked against.

### Allocation gap

`gap = target_pct − current_pct`, in percentage points, contributing
`gap_weight × gap` to the score. Set targets per ETF on the Watchlist page; they
should sum to 100 and the app tells you when they don't. `gap_weight = 0`
ignores targets entirely; higher values make them dominate cheapness.

### Premium over NAV

NAV comes from AMFI's daily file, joined to NSE tickers by ISIN via Groww's
instrument master. An ETF trading more than `max_premium_pct` above NAV is
refused — you would be paying more than the underlying is worth.

This is not theoretical: MON100 measured **+16.12% over NAV** during
development, because Indian funds hitting the SEBI overseas cap cannot create
new units. International ETFs also publish NAV a day late, so a NAV up to
`max_nav_age_days` old is still used; older than that and the check is skipped
rather than trusted.

---

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   This creates the tables, the RLS policies, and seeds the allowlist with
   `vansh.gupta@storemink.com`. Change that seed line first if you want a
   different first user.
3. **Project Settings → API** — copy the *Project URL* and the *anon public*
   key. You need both in step 4.

> Do **not** use the `service_role` key anywhere in this app. It bypasses Row
> Level Security, which is the only thing enforcing the email allowlist.

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type *Web application*.
2. Under **Authorised redirect URIs**, add exactly:
   ```
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
   ```
   That is Supabase's callback, not your app's — a common mistake.
3. In Supabase → **Authentication → Providers → Google**: enable it and paste
   the Client ID and Client Secret.
4. In Supabase → **Authentication → URL Configuration**:
   - *Site URL*: your Vercel URL (e.g. `https://etf-advisor.vercel.app`)
   - *Redirect URLs*: add both
     ```
     https://YOUR-APP.vercel.app/auth/callback
     http://localhost:3000/auth/callback
     ```

### 3. Run it locally

```bash
cd web
cp .env.example .env.local     # fill in the two values
npm install
npm run dev
```

### 4. Price fetcher (GitHub Actions)

The workflow lives at `.github/workflows/fetch-prices.yml` in the repo root.

1. Push this repo to GitHub.
2. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (Project Settings →
     API). It bypasses RLS, which is what lets the job write. It belongs only
     here, never in Vercel or the app.
   - `SUPABASE_URL` — the Project URL. Optional if you already have a secret
     named `NEXT_PUBLIC_SUPABASE_URL`; the workflow accepts either.

   > The **anon** key will not work here. Under RLS it has read-only access to
   > `prices`, so the write fails. The job checks the key's role claim up front
   > and stops with a clear message rather than a confusing 401 later.
3. **Actions tab → Fetch ETF prices → Run workflow** to populate the table
   immediately. Until you do, the dashboard will say there's no price data.

It then runs every 30 minutes during NSE hours (09:15–15:30 IST) plus once
after the close. Adjust the cron in the workflow if you want it less often —
a weekly buyer doesn't need 30-minute freshness.

To add a new ETF, add it on the Watchlist page; the next run picks it up
automatically because the job reads the watchlist from Supabase.

### 5. Deploy to Vercel

1. Import the Git repo in Vercel.
2. **Set Root Directory to `web`** — the repo root is the Python project, so a
   default import will fail to find a Next.js app.
3. Add both environment variables from `.env.example` (Production and Preview).
   Do **not** add the service-role key here.
4. Deploy, then go back and set Supabase's *Site URL* / *Redirect URLs* to the
   real deployment URL.

### 6. Add more people

Sign in, go to **Settings → Who can sign in**, add their Google address. Anyone
not listed can complete Google sign-in but is immediately signed back out and
shown a refusal — and even if they held a session, Postgres returns them zero
rows.

The database refuses to delete the *last* allowed email, so you cannot lock
yourself out entirely.

---

## Using it

| Page | What it does |
| --- | --- |
| **Advisor** | Runs the strategy: recommendation, cheapness ranking, discarded ETFs, portfolio table |
| **Watchlist** | ETFs the advisor may recommend. Use exact NSE symbols |
| **Portfolio** | What you own. Include ETFs *not* on the watchlist — they count toward your total |
| **Settings** | Budget, concentration cap, limit buffer, and the email allowlist |

Prices are whatever the last Action run wrote. The dashboard shows their age,
and warns prominently once they're more than 90 minutes old — that usually
means the scheduled job failed, so check the Actions tab.

---

## Known limitations

**Prices are only as fresh as the last fetch.** Between runs the app shows the
last known price. On the default schedule that's at most 30 minutes stale
during market hours. Always confirm the price in the Groww app before entering
an order.

**GitHub's cron is best-effort.** Scheduled workflows can be delayed by several
minutes under load, and GitHub disables schedules on repos with no activity for
60 days. If prices go stale, that's the first thing to check.

**No iNAV / premium check.** International ETFs such as MON100 can trade well
above the value of their holdings when Indian funds hit their overseas limit.
Yahoo doesn't publish iNAV, so nothing here checks it.

**Not financial advice.** This tool computes and reports numbers. Every decision
is yours.

---

## Tests

```bash
cd web && node --experimental-strip-types scripts/test-strategy.ts
```

36 assertions covering the drawdown window consistency, history confidence,
premium-over-NAV handling, allocation-gap ranking, staleness refusal, and the
budget walk.

One fixture note worth knowing if you add tests: a **flat or sine price series
fails the trend check**, because its moving averages sit at the same level as
the price, so it is correctly discarded as "still falling". Use the `rising()` /
`pulledBack()` helpers, which pass the trend check by construction.

## The local Python script has diverged

`main.py` in the repo root is the original standalone advisor. It shares the
cheapness formula and the trend rule, and it has the same drawdown-window fix
and 252-session minimum. But it does **not** have:

- target allocations or allocation-gap scoring (no database to read them from)
- the premium-over-NAV check
- the stale-session refusal

That last two matter. Running `main.py` today recommends MON100 — the ETF the
web app refuses because it is 16% above NAV. **Treat the web app as
authoritative**, and either retire `main.py` or remember what it doesn't check.
