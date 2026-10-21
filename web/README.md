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
2. HISTORY     need `min_candles` daily closes (default 252)
3. PREMIUM     price too far above iNAV / NAV, absolutely or for this ETF -> discard
4. BUDGET      discard anything one unit of which busts the budget
5. MARKS       cheapness and allocation gap, each marked 0-100 against the
               ETFs still in the running
6. SCORE       final = 0.5 x cheapness marks + 0.5 x allocation marks
7. RECOMMEND   the highest score
```

**Half the score is how cheap an ETF is against its own last 14 sessions; half
is how far it sits below its target.**

There is no trend filter: an ETF still sliding below its moving averages is
marked like any other. There is no hard concentration cap either — an ETF above
its target simply earns low allocation marks.

### Freshness

Staleness is counted in NSE trading sessions, not calendar days, so a Monday
morning run correctly expects Friday's bar and a long weekend is not a gap.
Today only counts as a session once the 15:30 IST close has passed. The session
calendar is only as good as the **NSE holidays** list on the Settings page: a
missing holiday reads as a skipped session, which is what the default
`max_bar_age_sessions = 1` of slack absorbs.

### Cheapness

`below_avg = (avg14 − live) / avg14`, where `avg14` is the mean of the ETF's
last 14 completed daily closes. Positive means it trades below its recent
average. During market hours Yahoo's newest daily bar is today's own, so it is
left out — the live price takes its place rather than being averaged against
itself.

This is a raw percentage, so ETFs that swing further (MON100, small caps) take
the top cheapness marks more often than steady ones. The allocation half is the
counterweight: every purchase raises the bought ETF's weight and lowers its
allocation marks next time.

### Allocation gap

`gap = target_pct − current_pct`, in percentage points, where `current_pct` is
the ETF's share of everything you hold — including holdings off the watchlist.
Set targets per ETF on the Watchlist page. They should sum to 100: more than
1pp off and the dashboard warns, more than 5pp off and it refuses to recommend.
An ETF with no target counts as exactly on target (gap 0).

### Marks and the score

Each metric is marked 0–100 **against the other ETFs still in the running**:
the best value gets 100, the worst gets 0, and the rest in proportion to where
they fall between. If every ETF has the same value on a metric — or only one
ETF is left — they all get a neutral 50 on it. Then

`score = 0.5 × cheapness marks + 0.5 × allocation marks`

and the highest score is recommended. Because marks are relative, the budget
check runs first: an ETF you cannot afford would otherwise stretch the scale
everything else is marked on.

A worked example, all three at the same 14-day average of Rs.100:

| ETF | Price vs avg | Cheapness | Weight / target | Gap | Allocation | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 5% below | 100 | 38.9% / 40% | +1.1pp | 54 | **77.1** |
| B | 2% below | 40 | 10.0% / 30% | +20.0pp | 100 | 70.0 |
| C | at it | 0 | 51.1% / 30% | −21.1pp | 0 | 0.0 |

A wins. Hold enough A to put it 18.8pp over target and its allocation marks
drop to 0: it scores 50 on cheapness alone and B wins with 70.

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
| **Settings** | Light / dark / follow-the-phone theme, budget, premium limits, history and freshness limits, NSE holidays, limit buffer, and the email allowlist. The 50/50 score split is fixed in code |

Prices are whatever the last Action run wrote. The dashboard shows the newest
session on file and when the fetcher last ran, and refuses to recommend
anything once the data is more than `max_bar_age_sessions` NSE sessions behind
— that usually means the scheduled job failed, so check the Actions tab.

**On a phone**, open the site and use *Add to Home Screen* (Safari's share
sheet, or Chrome's menu). It installs with its own icon and opens full-screen
with the bottom tab bar, like a native app. **Copy order** on the pick card
puts `SYMBOL BUY qty @ price LIMIT` on the clipboard for pasting into Groww.

### Design preview

`npm run dev`, then open <http://localhost:3000/preview>. Every screen renders
from sample data (`src/app/preview/fixtures.ts`) scored by the real strategy —
no database, no sign-in. The strip under the header switches between the
normal, warning, no-buy, stale and empty states. It exists only under
`next dev`: the proxy lets `/preview` through unauthenticated in development
only, and a production build serves a 404 there.

The screens themselves live in `src/components/views/`; each page in
`src/app/(app)/` only fetches data and hands it to its view, which is what
lets the preview render them without Supabase.

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

Covers the 14-day cheapness window, 0–100 mark scaling and its ties, the 50/50
score and the ranking it produces, the absence of a trend filter, iNAV vs EOD
NAV selection and staleness, the premium percentile gate and noise floor,
premium-sensitive ETFs failing closed, the NSE session calendar, stale-data
refusal, the integrity gates (unpriced holdings, target sums), and the budget
check — including that an unaffordable ETF never stretches the marking scale.
Exits non-zero on any failure.

Fixture note if you add tests: `flat(level)` makes the 14-day average exactly
`level`, so a live price of 95 on `flat(100)` is precisely 5% below it.

## The local Python script has diverged

`main.py` in the repo root is the original standalone advisor, and it still runs
the **old** strategy. Where the web app now scores 50/50 on cheapness against the
14-day average and allocation gap, `main.py`:

- scores cheapness against each ETF's own past year — where the price sits in
  its 1-year range, and how unusual today's dip from its 50-day high is
- drops any ETF trading below both its 50-day and 14-day averages
- has no target allocations (no database to read them from) and uses a hard
  `MAX_WEIGHT_PCT` concentration cap instead
- has no premium-over-NAV check
- has no stale-session refusal

So the two will often recommend different ETFs. The last two gaps matter most:
when this was written, `main.py` recommended MON100 —
the ETF the web app refuses because it was 16% above NAV. **Treat the web app as
authoritative**, and either retire `main.py` or remember what it doesn't check.
