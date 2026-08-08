"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dispatchPriceFetch } from "@/lib/github";

/**
 * Server Actions for every write. All go through the anon-key client, so the
 * RLS allowlist decides whether they're permitted — these functions never
 * check permissions themselves and never need to.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

// ─────────────────────────────────────────────
//  RUN THE ADVISOR
// ─────────────────────────────────────────────
export type RunState =
  | { phase: "idle" }
  | { phase: "fetching"; since: string | null; note?: string }
  | { phase: "ready"; note?: string }
  | { phase: "error"; error: string };

/**
 * Kick off a price refresh. Returns immediately with the timestamp of the
 * prices we had BEFORE dispatching, so the client can poll until it changes.
 */
export async function startRun(): Promise<RunState> {
  const supabase = await createClient();

  const { data: allowed } = await supabase.rpc("is_allowed");
  if (allowed !== true) return { phase: "error", error: "Your account is not allowed." };

  const { data } = await supabase
    .from("prices")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since: string | null = data?.fetched_at ?? null;

  const outcome = await dispatchPriceFetch();

  if (outcome.status === "dispatched") return { phase: "fetching", since };
  if (outcome.status === "not-configured") {
    // No GitHub token: nothing to wait for, just re-score what's stored.
    revalidatePath("/");
    return { phase: "ready", note: outcome.detail };
  }
  return { phase: "error", error: outcome.detail };
}

/**
 * Has the fetcher written newer prices than `since`?
 * Polled by the client while a run is in flight.
 */
export async function checkRun(since: string | null): Promise<{ fresh: boolean; at: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prices")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const at: string | null = data?.fetched_at ?? null;
  const fresh = at !== null && (since === null || Date.parse(at) > Date.parse(since));
  if (fresh) revalidatePath("/");
  return { fresh, at };
}


/** NSE symbols are uppercase with no spaces. Normalise before it hits Postgres. */
function normaliseSymbol(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function friendly(error: { message: string; code?: string }): string {
  if (error.code === "23505" || error.message.includes("duplicate key")) {
    return "That symbol is already in the list.";
  }
  if (error.message.includes("symbol_format")) {
    return "Symbols must be uppercase with no spaces, e.g. GOLDBEES.";
  }
  if (error.message.includes("lock yourself out")) {
    return "You cannot remove the last allowed email — you would lose access permanently.";
  }
  if (error.message.includes("violates row-level security")) {
    return "Your account is not allowed to make changes.";
  }
  return error.message;
}

// ─────────────────────────────────────────────
//  WATCHLIST
// ─────────────────────────────────────────────
/**
 * Target allocation. Blank is meaningful — "no target", so this ETF scores on
 * cheapness alone and contributes nothing to the allocation gap.
 */
function parseTarget(raw: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return "invalid";
  return value;
}

export async function addWatchlistItem(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));
  const name = String(formData.get("name") ?? "").trim();
  const target = parseTarget(formData.get("target_pct"));

  if (!symbol) return { ok: false, error: "Symbol is required." };
  if (!name) return { ok: false, error: "Name is required." };
  if (target === "invalid") {
    return { ok: false, error: "Target must be between 0 and 100, or left blank." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist")
    .insert({ symbol, name, target_pct: target });
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/watchlist");
  revalidatePath("/");
  return { ok: true };
}

export async function updateWatchlistItem(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));
  const name = String(formData.get("name") ?? "").trim();
  const target = parseTarget(formData.get("target_pct"));

  if (!name) return { ok: false, error: "Name cannot be empty." };
  if (target === "invalid") {
    return { ok: false, error: "Target must be between 0 and 100, or left blank." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist")
    .update({ name, target_pct: target })
    .eq("symbol", symbol);
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/watchlist");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteWatchlistItem(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));

  const supabase = await createClient();
  const { error } = await supabase.from("watchlist").delete().eq("symbol", symbol);
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/watchlist");
  revalidatePath("/");
  return { ok: true };
}

// ─────────────────────────────────────────────
//  HOLDINGS
// ─────────────────────────────────────────────
export async function upsertHolding(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));
  const unitsRaw = String(formData.get("units") ?? "").trim();
  const avgRaw = String(formData.get("avg_price") ?? "").trim();

  if (!symbol) return { ok: false, error: "Symbol is required." };

  const units = Number(unitsRaw);
  if (!Number.isInteger(units) || units < 0) {
    return { ok: false, error: "Units must be a whole number of 0 or more." };
  }

  // Blank is meaningful: "I don't know my cost basis". Stored as null, and the
  // UI then shows "—" for invested and P&L instead of inventing a number.
  let avgPrice: number | null = null;
  if (avgRaw !== "") {
    avgPrice = Number(avgRaw);
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
      return { ok: false, error: "Average price must be a positive number, or left blank." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holdings").upsert(
    { symbol, units, avg_price: avgPrice, updated_at: new Date().toISOString() },
    { onConflict: "symbol" },
  );
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/portfolio");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteHolding(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));

  const supabase = await createClient();
  const { error } = await supabase.from("holdings").delete().eq("symbol", symbol);
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/portfolio");
  revalidatePath("/");
  return { ok: true };
}

// ─────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────
export async function updateSettings(formData: FormData): Promise<ActionResult> {
  const num = (key: string) => Number(String(formData.get(key) ?? ""));

  const budget = num("budget");
  const limitBufferPct = num("limit_buffer_pct");
  const gapWeight = num("gap_weight");
  const gapKneePct = num("gap_knee_pct");
  const maxPremiumPct = num("max_premium_pct");
  const premiumFloorPct = num("premium_floor_pct");
  const maxPremiumPctile = num("max_premium_pctile");
  const minCandles = num("min_candles");
  const maxBarAgeSessions = num("max_bar_age_sessions");
  const maxNavAgeDays = num("max_nav_age_days");
  const maxInavAgeMinutes = num("max_inav_age_minutes");

  // One ISO date per line. Anything else is rejected rather than dropped: a
  // silently ignored line would turn a real holiday into an expected session.
  const holidayLines = String(formData.get("nse_holidays") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badHoliday = holidayLines.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
  const nseHolidays = Array.from(new Set(holidayLines)).sort();

  const problems: Array<[boolean, string]> = [
    [!Number.isFinite(budget) || budget <= 0, "Budget must be a positive number."],
    [
      !Number.isFinite(limitBufferPct) || limitBufferPct < 0 || limitBufferPct > 5,
      "Limit buffer must be between 0 and 5 percent.",
    ],
    [
      !Number.isFinite(gapWeight) || gapWeight < 0 || gapWeight > 20,
      "Gap weight must be between 0 and 20.",
    ],
    [
      !Number.isFinite(gapKneePct) || gapKneePct < 1 || gapKneePct > 50,
      "Gap knee must be between 1 and 50 percentage points.",
    ],
    [
      !Number.isFinite(maxPremiumPct) || maxPremiumPct < 0 || maxPremiumPct > 50,
      "Max premium must be between 0 and 50 percent.",
    ],
    [
      !Number.isFinite(premiumFloorPct) || premiumFloorPct < 0 || premiumFloorPct > 5,
      "Premium noise floor must be between 0 and 5 percent.",
    ],
    [
      !Number.isFinite(maxPremiumPctile) || maxPremiumPctile < 50 || maxPremiumPctile > 100,
      "Max premium percentile must be between 50 and 100.",
    ],
    [
      !Number.isInteger(minCandles) || minCandles < 60 || minCandles > 500,
      "Minimum history must be a whole number between 60 and 500 sessions.",
    ],
    [
      !Number.isInteger(maxBarAgeSessions) || maxBarAgeSessions < 0 || maxBarAgeSessions > 5,
      "Max price lag must be a whole number of sessions between 0 and 5.",
    ],
    [
      !Number.isInteger(maxNavAgeDays) || maxNavAgeDays < 1 || maxNavAgeDays > 30,
      "Max NAV age must be a whole number of days between 1 and 30.",
    ],
    [
      !Number.isInteger(maxInavAgeMinutes) || maxInavAgeMinutes < 5 || maxInavAgeMinutes > 1440,
      "Max iNAV age must be a whole number of minutes between 5 and 1440.",
    ],
    [
      badHoliday !== undefined,
      `"${badHoliday}" is not an ISO date — NSE holidays must be yyyy-mm-dd, one per line.`,
    ],
  ];
  const firstProblem = problems.find(([bad]) => bad);
  if (firstProblem) return { ok: false, error: firstProblem[1] };

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      budget,
      limit_buffer_pct: limitBufferPct,
      gap_weight: gapWeight,
      gap_knee_pct: gapKneePct,
      max_premium_pct: maxPremiumPct,
      premium_floor_pct: premiumFloorPct,
      max_premium_pctile: maxPremiumPctile,
      min_candles: minCandles,
      max_bar_age_sessions: maxBarAgeSessions,
      max_nav_age_days: maxNavAgeDays,
      max_inav_age_minutes: maxInavAgeMinutes,
      nse_holidays: nseHolidays,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

// ─────────────────────────────────────────────
//  ALLOWED EMAILS
// ─────────────────────────────────────────────
export async function addAllowedEmail(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("allowed_emails")
    .insert({ email, added_by: user?.email ?? null });
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/settings");
  return { ok: true };
}

export async function removeAllowedEmail(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const { error } = await supabase.from("allowed_emails").delete().eq("email", email);
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/settings");
  return { ok: true };
}
