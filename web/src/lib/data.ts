import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/strategy";

export type WatchlistItem = { symbol: string; name: string; targetPct: number | null };
export type Holding = { symbol: string; units: number; avgPrice: number | null };
export type AllowedEmail = { email: string; added_by: string | null; added_at: string };

// The defaults live with the strategy that consumes them — one source of truth.
export { DEFAULT_SETTINGS };

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist")
    .select("symbol, name, target_pct")
    .order("symbol");

  return (data ?? []).map((row) => ({
    symbol: row.symbol as string,
    name: row.name as string,
    // numeric arrives as a string from PostgREST; null means "no target set".
    targetPct: row.target_pct === null ? null : Number(row.target_pct),
  }));
}

export async function getHoldings(): Promise<Holding[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("holdings")
    .select("symbol, units, avg_price")
    .order("symbol");

  return (data ?? []).map((row) => ({
    symbol: row.symbol as string,
    units: Number(row.units),
    avgPrice: row.avg_price === null ? null : Number(row.avg_price),
  }));
}

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    // One literal, not a concatenation: supabase-js infers the row type from
    // the string, and only a literal carries the column names into the type.
    .select(
      "budget, limit_buffer_pct, gap_weight, gap_knee_pct, max_premium_pct, premium_floor_pct, max_premium_pctile, min_candles, max_bar_age_sessions, max_nav_age_days, max_inav_age_minutes, nse_holidays",
    )
    .eq("id", 1)
    .maybeSingle();

  // A database that predates the migration fails this select outright, which is
  // the safe outcome: strategy defaults are conservative, a half-populated
  // Settings object would not be.
  if (!data) return DEFAULT_SETTINGS;

  // Fall back per-field: an older row that predates the migration is missing
  // some columns, and a half-populated Settings object would be worse than
  // defaults for the fields that aren't there yet.
  const num = (v: unknown, fallback: number) =>
    v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v);

  return {
    budget: num(data.budget, DEFAULT_SETTINGS.budget),
    limitBufferPct: num(data.limit_buffer_pct, DEFAULT_SETTINGS.limitBufferPct),
    gapWeight: num(data.gap_weight, DEFAULT_SETTINGS.gapWeight),
    gapKneePct: num(data.gap_knee_pct, DEFAULT_SETTINGS.gapKneePct),
    maxPremiumPct: num(data.max_premium_pct, DEFAULT_SETTINGS.maxPremiumPct),
    premiumFloorPct: num(data.premium_floor_pct, DEFAULT_SETTINGS.premiumFloorPct),
    maxPremiumPctile: num(data.max_premium_pctile, DEFAULT_SETTINGS.maxPremiumPctile),
    minCandles: num(data.min_candles, DEFAULT_SETTINGS.minCandles),
    maxBarAgeSessions: num(data.max_bar_age_sessions, DEFAULT_SETTINGS.maxBarAgeSessions),
    maxNavAgeDays: num(data.max_nav_age_days, DEFAULT_SETTINGS.maxNavAgeDays),
    maxInavAgeMinutes: num(data.max_inav_age_minutes, DEFAULT_SETTINGS.maxInavAgeMinutes),
    // jsonb array of ISO dates; anything malformed is dropped rather than
    // silently turning a real trading day into a holiday.
    nseHolidays: Array.isArray(data.nse_holidays)
      ? (data.nse_holidays as unknown[]).filter(
          (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
        )
      : DEFAULT_SETTINGS.nseHolidays,
  };
}

export async function getAllowedEmails(): Promise<AllowedEmail[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("allowed_emails")
    .select("email, added_by, added_at")
    .order("added_at");
  return data ?? [];
}
