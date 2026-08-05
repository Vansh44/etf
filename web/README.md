# ETF Advisor — web app

Hosted version of the local Python advisor. Tells you which watchlist ETF is
cheapest right now and how many units fit your budget. **It places no orders** —
you place the trade yourself in the Groww app.

- **Data**: Yahoo Finance, fetched by a scheduled GitHub Action into Supabase
- **Backend**: Supabase Postgres
- **Auth**: Google sign-in, restricted to an email allowlist
- **Host**: Vercel

The strategy logic in `src/lib/strategy.ts` is a verified port of the Python
`main.py` — see [Parity](#parity) below.

## How the data gets in

```
GitHub Action (cron)  ──yfinance──>  Yahoo
        │
        └── writes closes + live price ──>  Supabase `prices`
                                                  │
                                    Vercel app ───┘  (reads only)
```

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
1. TREND CHECK   above its 50-day average           -> keep
                 below 50-day, above the 14-day      -> keep (dip turning up)
                 below BOTH                          -> discard, still falling
2. CHEAPNESS     score survivors 0-100, cheapest first
3. CAP           skip anything already over MAX_WEIGHT_PCT of the portfolio
4. BUDGET        skip anything one unit of which busts the budget
5. RECOMMEND     the first candidate that survives
```

Cheapness is measured against each ETF's **own** history, never against the
other ETFs, so a volatile ETF and a steady one are comparable. The rupee price
level carries no information — the score is scale-invariant.

- **A** — where the live price sits in its own trailing 1-year range of closes
  (0 = at its 52-week low) → contributes `100 − percentile`
- **B** — today's drawdown from its 50-day high, ranked against its own past
  year of drawdowns → contributes that percentile
- `cheapness = (A + B) / 2`

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
   - `SUPABASE_URL` — same Project URL as above
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (Project Settings →
     API). This one bypasses RLS, which is what lets the job write. It belongs
     only here, never in Vercel or the app.
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

## Parity

`src/lib/strategy.ts` must agree with the Python `main.py`. To re-verify:

```bash
python3 web/scripts/make_fixture.py
```

```bash
cd web && node --experimental-strip-types scripts/parity.ts scripts/fixture.json > scripts/actual.json
```

Then diff `scripts/actual.json` against `scripts/expected.json`. Both sides read
the *same* closes and live prices from `fixture.json`, so a price tick between
runs can't masquerade as a port bug. Last checked: all 7 symbols × 10 fields
identical to within 1e-6.

There's also an end-to-end check that hits Yahoo for real:

```bash
cd web && node --experimental-strip-types scripts/e2e.ts
```
