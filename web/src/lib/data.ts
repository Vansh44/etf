import { createClient } from "@/lib/supabase/server";

export type WatchlistItem = { symbol: string; name: string };
export type Holding = { symbol: string; units: number };
export type Settings = { budget: number; maxWeightPct: number; limitBufferPct: number };
export type AllowedEmail = { email: string; added_by: string | null; added_at: string };

export const DEFAULT_SETTINGS: Settings = {
  budget: 2500,
  maxWeightPct: 40,
  limitBufferPct: 0.2,
};

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("watchlist").select("symbol, name").order("symbol");
  return data ?? [];
}

export async function getHoldings(): Promise<Holding[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("holdings").select("symbol, units").order("symbol");
  return data ?? [];
}

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("budget, max_weight_pct, limit_buffer_pct")
    .eq("id", 1)
    .maybeSingle();

  if (!data) return DEFAULT_SETTINGS;
  return {
    budget: Number(data.budget),
    maxWeightPct: Number(data.max_weight_pct),
    limitBufferPct: Number(data.limit_buffer_pct),
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
