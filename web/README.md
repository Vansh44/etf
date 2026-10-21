# ETF Advisor — web app

Hosted version of the local Python advisor. Tells you which watchlist ETF is
cheapest right now and how many units fit your budget. **It places no orders** —
you place the trade yourself in the Groww app.

- **Data**: Yahoo Finance prices, AMFI end-of-day NAVs and NSE intraday iNAVs, fetched by a scheduled GitHub Action into Supabase
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
0. INTEGRITY   refuse everything if a held ETF has no price, or if the targets
               are more than 5pp away from summing to 100
1. FRESHNESS   refuse everything if prices are more than `max_bar_age_sessions`
               NSE sessions behind; exclude any symbol whose bar lags the newest one
2. HISTORY     need `min_candles` sessions (default 252). Below the 252-session
               scoring window, cheapness is discounted for confidence
3. TREND       above the 50-day avg        -> keep
               below 50-day, above 14-day   -> keep (dip turning up)
               below BOTH                   -> discard, still falling
4. PREMIUM     price too far above iNAV / NAV, absolutely or for this ETF -> discard
5. SCORE       final = cheapness x confidence + shaped allocation gap
6. BUDGET      skip anything one unit of which busts the budget
7. RECOMMEND   the highest-scoring candidate that fits
```

**Cheapness decides when to buy; the allocation gap decides what to buy.**

There is no hard concentration cap. An ETF above its target earns a *negative*
gap, which lowers its score, instead of being blocked outright — and that
penalty turns quadratic past `gap_knee_pct`, so an extreme overweight cannot win.

### Freshness

Staleness is counted in NSE trading sessions, not calendar days, so a Monday
morning run correctly expects Friday's bar and a long weekend is not a gap.
Today only counts as a session once the 15:30 IST close has passed. The session
calendar is only as good as the **NSE holidays** list on the Settings page: a
missing holiday reads as a skipped session, which is what the default
`max_bar_age_sessions = 1` of slack absorbs.

### Cheapness (0–100)

Measured against each ETF's **own** history, never against the other ETFs, so a
volatile ETF and a steady one are comparable. Scale-invariant — the rupee price
level carries no information.

- **A** — where the live price sits in its own trailing 1-year range of closes
  (0 = at its 52-week low) → contributes `100 − percentile`
- **B** — today's drawdown from its 50-day high, ranked against its own past
  year of drawdowns → contributes that percentile
- `cheapness = 0.25 × A + 0.75 × B`

The split is deliberately lopsided. A is a trend-level measure — anything in a
sustained uptrend reads expensive on it forever — and the same rising price
already pushes that ETF overweight and its allocation gap negative, so weighting
A heavily would penalise a strong compounder twice for one cause. B ranks
today's dip against the ETF's own dips, so it is genuinely mean-reverting.

Both drawdown windows are exactly `HIGH_LOOKBACK` observations wide: history
uses `closes[i-look+1 .. i]`, and today uses `look − 1` prior closes plus the
live price. Getting this wrong gives today a window one observation too wide,
which makes today's dip look systematically deeper than the history it is
ranked against.

### Allocation gap

`gap = target_pct − current_pct`, in percentage points. Inside `gap_knee_pct`
(default 5) it contributes `gap_weight × gap`; beyond the knee the magnitude
becomes `|gap| + (|gap| − knee)² / knee`. That is continuous in both value and
slope at the knee, so ordinary drift scores exactly as a linear term would,
while a 15pp overweight at weight 1.5 costs 52.5 points instead of 22.5 — more
than any cheapness score can make up.

Set targets per ETF on the Watchlist page. They should sum to 100: more than
1pp off and the dashboard warns, more than 5pp off and it refuses to recommend.
An ETF with no target scores on cheapness alone. `gap_weight = 0` ignores
targets entirely; higher values make them dominate cheapness.

### Premium over fair value

The reference is the **iNAV** — NSE's intraday indicative NAV, already adjusted
for currency — when the fetcher caught one in session and it is no older than
`max_inav_age_minutes`. Otherwise it falls back to AMFI's **end-of-day NAV**,
joined to NSE tickers by ISIN via Groww's instrument master, if it is no older
than `max_nav_age_days`. The EOD NAV is the weaker reference: for MON100 on a
Monday morning it reflects Thursday's Nasdaq close plus days of rupee drift.

Two gates, either of which discards the ETF:

- **Absolute** — trading more than `max_premium_pct` (default 3%) above the
  reference. You would be paying well over what the underlying is worth.
- **Relative** — the premium is above `premium_floor_pct` (default 0.75%) *and*
  above the `max_premium_pctile` (default 90th) percentile of this ETF's own
  `premium_history`. Every ETF has its own baseline, so this is self-calibrating.
  It stays quiet until there are 60 samples.

This is not theoretical: MON100 measured **+16.12% over NAV** during
development, because Indian funds hitting the SEBI overseas cap cannot create
new units.

**Premium-sensitive ETFs fail closed.** For most ETFs a premium that cannot be
checked — no fresh iNAV and no usable NAV — is waved through. Tick **Can trade
far from NAV** on the Watchlist page for international or thinly traded ETFs
(MON100 is seeded on) and they are refused instead. When one of them is judged
only against the EOD NAV, the dashboard warns that the number carries a day of
index and currency drift.

---

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   This creates the tables, the RLS policies, and seeds the allowlist with
   `vansh.gupta@storemink.com`. Change that seed line first if you want a
   different first user.
3. **Project Settings → API** — copy the *Project URL* and the *anon public*
   key. You need both in step 3.

The file is a base schema followed by migrations, each safe to re-run. After
pulling changes, paste the whole file again — that applies any new migration
and leaves your data alone.

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

Create `web/.env.local` with the two values from step 1:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Then:

```bash
cd web
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
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Production and Preview). Do **not** add the service-role key here.

   Optional: add `GITHUB_TOKEN` and `GITHUB_REPO` (`owner/name`) and the
   dashboard's Run button triggers the fetcher and waits for fresh prices,
   instead of only re-scoring the stored ones. The token needs **Actions:
   write** on the repo (fine-grained) or the `workflow` scope (classic).
   `GITHUB_WORKFLOW_FILE` and `GITHUB_REF_NAME` default to `fetch-prices.yml`
   and `main`.
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
| **Advisor** | Runs the strategy: recommendation with its score breakdown, ranking, excluded ETFs and why, warnings, portfolio summary |
| **Watchlist** | ETFs the advisor may recommend, each one's target allocation, and whether it can trade far from NAV. Use exact NSE symbols |
| **Portfolio** | What you own, with average buy prices for P&L. Include ETFs *not* on the watchlist — they count toward your total |
| **Settings** | Budget, gap weight and knee, premium limits, history and freshness limits, NSE holidays, limit buffer, and the email allowlist |

Prices are whatever the last Action run wrote. The dashboard shows the newest
session on file and when the fetcher last ran, and refuses to recommend
anything once the data is more than `max_bar_age_sessions` NSE sessions behind
— that usually means the scheduled job failed, so check the Actions tab.

---

## Known limitations

**Prices are only as fresh as the last fetch.** Between runs the app shows the
last known price. On the default schedule that's at most 30 minutes stale
during market hours. Always confirm the price in the Groww app before entering
an order.

**GitHub's cron is best-effort.** Scheduled workflows can be delayed by several
minutes under load, and GitHub disables schedules on repos with no activity for
60 days. If prices go stale, that's the first thing to check.

**iNAV is only there in market hours, and not always then.** The fetcher keeps
NSE's iNAV only when the board is stamped for the current session; outside
hours the premium check falls back to AMFI's end-of-day NAV. NSE also rejects
some datacentre IPs, so a GitHub runner may get no iNAV at all on a given run.

**The premium percentile compares slightly unlike things.** No historical iNAV
is published anywhere, so `premium_history` is built from end-of-day NAVs while
today's premium is measured against the iNAV when there is one. For an ETF
whose underlying trades overnight (MON100) the two sit at systematically
different levels. For those ETFs it is the absolute `max_premium_pct` cap, not
the percentile, that does the real work.

**Not financial advice.** This tool computes and reports numbers. Every decision
is yours.

---

## Tests

```bash
cd web && node --experimental-strip-types scripts/test-strategy.ts
```

Covers the drawdown window consistency, history confidence, iNAV vs EOD NAV
selection and staleness, the premium percentile gate and noise floor,
premium-sensitive ETFs failing closed, gap shaping and allocation-gap ranking,
the NSE session calendar, stale-data refusal, the integrity gates (unpriced
holdings, target sums), and the budget walk. Exits non-zero on any failure.

One fixture note worth knowing if you add tests: a **flat or sine price series
fails the trend check**, because its moving averages sit at the same level as
the price, so it is correctly discarded as "still falling". Use the `rising()` /
`pulledBack()` helpers, which pass the trend check by construction.

## The local Python script has diverged

`main.py` in the repo root is the original standalone advisor. It shares the
two cheapness components and the trend rule, and it has the same drawdown-window
fix and 252-session minimum. But it does **not** have:

- target allocations or allocation-gap scoring (no database to read them from) —
  it uses a hard `MAX_WEIGHT_PCT` concentration cap instead
- the 25/75 cheapness weighting — it still averages the two components 50/50
- the premium-over-NAV check
- the stale-session refusal

The last two matter most. When this was written, `main.py` recommended MON100 —
the ETF the web app refuses because it was 16% above NAV. **Treat the web app as
authoritative**, and either retire `main.py` or remember what it doesn't check.
