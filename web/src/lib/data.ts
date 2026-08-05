import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/strategy";

export type WatchlistItem = { symbol: string; name: string; targetPct: number | null };
export type Holding = { symbol: string; units: number; avgPrice: number | null };
export type AllowedEmail = { email: string; added_by: string | null; added_at: string };

export const DEFAULT_SETTINGS: Settings = {
  budget: 2500,
  limitBufferPct: 0.2,
  gapWeight: 1,
  maxPremiumPct: 1.5,
  minCandles: 252,
  maxBarAgeDays: 4,
  maxNavAgeDays: 3,
};

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
    .select(
      "budget, limit_buffer_pct, gap_weight, max_premium_pct, min_candles, max_bar_age_days, max_nav_age_days",
    )
    .eq("id", 1)
    .maybeSingle();

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
    maxPremiumPct: num(data.max_premium_pct, DEFAULT_SETTINGS.maxPremiumPct),
    minCandles: num(data.min_candles, DEFAULT_SETTINGS.minCandles),
    maxBarAgeDays: num(data.max_bar_age_days, DEFAULT_SETTINGS.maxBarAgeDays),
    maxNavAgeDays: num(data.max_nav_age_days, DEFAULT_SETTINGS.maxNavAgeDays),
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
