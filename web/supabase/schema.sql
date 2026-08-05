-- ============================================================================
--  ETF ADVISOR — Supabase schema
-- ============================================================================
--  Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
--  query -> paste -> Run). It is idempotent: safe to re-run.
--
--  SECURITY MODEL
--  Access is gated on an email allowlist, enforced by Row Level Security in
--  the database — NOT in the UI. Even if someone got your anon key and hit
--  the REST API directly with a valid Google login, Postgres refuses every
--  row unless their email is in allowed_emails.
-- ============================================================================

-- ─────────────────────────────────────────────
--  ALLOWLIST
-- ─────────────────────────────────────────────
create table if not exists allowed_emails (
  email    text primary key,
  added_by text,
  added_at timestamptz not null default now()
);

-- Seed the first allowed user. Without at least one row nobody can get in.
insert into allowed_emails (email, added_by)
values ('vansh.gupta@storemink.com', 'schema seed')
on conflict (email) do nothing;

-- Is the currently-logged-in user allowed?
--
-- SECURITY DEFINER so it can read allowed_emails while RLS is active on that
-- table — otherwise the policies below would recurse into themselves.
-- Emails are compared case-insensitively; Google can return mixed case.
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_allowed() from public;
grant execute on function public.is_allowed() to authenticated;

-- Refuse to remove the last allowed email — that would lock everyone out
-- permanently, recoverable only from the SQL editor.
create or replace function public.prevent_last_email_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from allowed_emails) <= 1 then
    raise exception 'Cannot remove the last allowed email — you would lock yourself out.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_last_email_delete on allowed_emails;
create trigger trg_prevent_last_email_delete
  before delete on allowed_emails
  for each row execute function public.prevent_last_email_delete();

-- ─────────────────────────────────────────────
--  WATCHLIST — ETFs the advisor may recommend
-- ─────────────────────────────────────────────
create table if not exists watchlist (
  symbol     text primary key,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint watchlist_symbol_format
    check (symbol = upper(symbol) and symbol !~ '\s' and length(symbol) between 1 and 30)
);

-- ─────────────────────────────────────────────
--  HOLDINGS — what you own
-- ─────────────────────────────────────────────
--  Deliberately NO foreign key to watchlist: you hold ETFs that are not on
--  the watchlist (gold, silver) and they must still count toward your
--  portfolio total, or every other weight would be overstated.
create table if not exists holdings (
  symbol     text primary key,
  units      integer not null default 0 check (units >= 0),
  -- Average price paid per unit. Nullable: you may not know it for older
  -- holdings, and the app shows "—" for invested/P&L rather than guessing.
  avg_price  numeric check (avg_price is null or avg_price > 0),
  updated_at timestamptz not null default now(),
  constraint holdings_symbol_format
    check (symbol = upper(symbol) and symbol !~ '\s' and length(symbol) between 1 and 30)
);

-- Safe to re-run on an existing database that predates avg_price.
alter table holdings add column if not exists avg_price numeric;
do $$
begin
  alter table holdings add constraint holdings_avg_price_positive
    check (avg_price is null or avg_price > 0);
exception when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────
--  SETTINGS — single row
-- ─────────────────────────────────────────────
create table if not exists settings (
  id              smallint primary key default 1 check (id = 1),
  budget          numeric  not null default 2500 check (budget > 0),
  max_weight_pct  numeric  not null default 40   check (max_weight_pct > 0 and max_weight_pct <= 100),
  limit_buffer_pct numeric not null default 0.20 check (limit_buffer_pct >= 0 and limit_buffer_pct <= 5),
  updated_at      timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ─────────────────────────────────────────────
--  PRICES — written by the GitHub Action, read by the app
-- ─────────────────────────────────────────────
--  Yahoo blocks non-browser TLS fingerprints, so Vercel cannot fetch prices
--  itself (it gets HTTP 429). Instead a scheduled GitHub Action runs Python +
--  yfinance, which impersonates Chrome's TLS via curl_cffi, and writes the
--  results here. The web app only ever reads this table.
create table if not exists prices (
  symbol      text primary key,
  live_price  numeric not null check (live_price > 0),
  closes      jsonb   not null,   -- daily closes, oldest first
  last_bar    date,
  fetched_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table allowed_emails enable row level security;
alter table watchlist      enable row level security;
alter table holdings       enable row level security;
alter table settings       enable row level security;
alter table prices         enable row level security;

-- One policy per table covering every operation. `using` gates reads, updates
-- and deletes; `with check` gates inserts and updates. Anonymous visitors match
-- no policy at all, so they see nothing.
drop policy if exists allowed_emails_allowed_only on allowed_emails;
create policy allowed_emails_allowed_only on allowed_emails
  for all to authenticated
  using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists watchlist_allowed_only on watchlist;
create policy watchlist_allowed_only on watchlist
  for all to authenticated
  using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists holdings_allowed_only on holdings;
create policy holdings_allowed_only on holdings
  for all to authenticated
  using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists settings_allowed_only on settings;
create policy settings_allowed_only on settings
  for all to authenticated
  using (public.is_allowed()) with check (public.is_allowed());

-- Prices are READ-ONLY to the app. Only the GitHub Action writes them, using
-- the service_role key, which bypasses RLS by design.
drop policy if exists prices_allowed_read on prices;
create policy prices_allowed_read on prices
  for select to authenticated
  using (public.is_allowed());

-- ─────────────────────────────────────────────
--  SEED (optional) — your current watchlist and holdings
-- ─────────────────────────────────────────────
--  Delete this block if you would rather start empty and add rows in the app.
insert into watchlist (symbol, name) values
  ('MOMIDMTM',  'Motilal Oswal Nifty Midcap 150 Momentum 50 ETF'),
  ('ALPHA',     'Kotak Nifty Alpha 50 ETF'),
  ('MODEFENCE', 'Motilal Oswal Nifty India Defence ETF'),
  ('MAKEINDIA', 'Mirae Asset Nifty India Manufacturing ETF'),
  ('BFSI',      'Mirae Asset Nifty Financial Services ETF'),
  ('MON100',    'Motilal Oswal NASDAQ 100 ETF'),
  ('INFRAIETF', 'ICICI Prudential Nifty Infrastructure ETF')
on conflict (symbol) do nothing;

-- Units and average buy price, as reported by the Groww holdings endpoint.
insert into holdings (symbol, units, avg_price) values
  ('MOMIDMTM',  45,  62.61),
  ('ALPHA',     10,  49.18),
  ('MODEFENCE', 39,  98.33),
  ('MAKEINDIA', 12, 158.06),
  ('BFSI',       0,  null),
  ('MON100',     1, 285.94),
  ('INFRAIETF', 30,  96.88),
  ('GOLDBEES',  92, 119.06),   -- held, not on the watchlist
  ('SILVERBEES', 20, 210.40)   -- held, not on the watchlist
on conflict (symbol) do nothing;

-- If your holdings rows already exist from an earlier run, this fills in the
-- average prices without touching your unit counts.
update holdings h set avg_price = v.avg_price
from (values
  ('MOMIDMTM',  62.61), ('ALPHA',     49.18), ('MODEFENCE',  98.33),
  ('MAKEINDIA', 158.06), ('MON100',  285.94), ('INFRAIETF',  96.88),
  ('GOLDBEES',  119.06), ('SILVERBEES', 210.40)
) as v(symbol, avg_price)
where h.symbol = v.symbol and h.avg_price is null;


-- ============================================================================
--  MIGRATION — target allocations, allocation-gap scoring, NAV, staleness
--  Safe to re-run. Apply by pasting this whole file again.
-- ============================================================================

-- ─── Target allocation per ETF ───────────────────────────────────────────────
-- Your desired portfolio shape, e.g. NIFTYBEES 35, GOLDBEES 15, SILVERBEES 5.
-- NULL means "no target" — such an ETF scores on cheapness alone.
-- A target only does something for ETFs on the watchlist, because those are the
-- only ones the advisor can recommend buying.
alter table watchlist add column if not exists target_pct numeric;
do $$ begin
  alter table watchlist add constraint watchlist_target_range
    check (target_pct is null or (target_pct >= 0 and target_pct <= 100));
exception when duplicate_object then null; end $$;

-- ─── Settings: the single cap is replaced by gap-based scoring ───────────────
alter table settings add column if not exists gap_weight       numeric not null default 1.0;
alter table settings add column if not exists max_premium_pct  numeric not null default 1.5;
alter table settings add column if not exists min_candles      integer not null default 252;
alter table settings add column if not exists max_bar_age_days integer not null default 4;
alter table settings add column if not exists max_nav_age_days integer not null default 3;

do $$ begin
  alter table settings add constraint settings_gap_weight_range
    check (gap_weight >= 0 and gap_weight <= 20);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table settings add constraint settings_premium_range
    check (max_premium_pct >= 0 and max_premium_pct <= 50);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table settings add constraint settings_min_candles_range
    check (min_candles >= 60 and min_candles <= 500);
exception when duplicate_object then null; end $$;

-- The concentration cap is gone: an overweight ETF now gets a negative
-- allocation gap, which lowers its score, instead of being hard-blocked.
alter table settings drop column if exists max_weight_pct;

-- ─── NAV, for the premium check ─────────────────────────────────────────────
-- Written by the fetcher from AMFI's daily NAV file, matched by ISIN.
-- nav_date can legitimately lag the price by a day for international ETFs
-- (MON100), which is why it is stored rather than assumed to be today.
alter table prices add column if not exists nav      numeric;
alter table prices add column if not exists nav_date date;
do $$ begin
  alter table prices add constraint prices_nav_positive check (nav is null or nav > 0);
exception when duplicate_object then null; end $$;

-- ─── Seed targets matching the current watchlist ────────────────────────────
-- Adjust freely in the app. These sum to 100.
update watchlist w set target_pct = v.target
from (values
  ('MOMIDMTM', 20), ('MODEFENCE', 15), ('MAKEINDIA', 15),
  ('BFSI',     15), ('INFRAIETF', 15), ('ALPHA',     10),
  ('MON100',   10)
) as v(symbol, target)
where w.symbol = v.symbol and w.target_pct is null;
