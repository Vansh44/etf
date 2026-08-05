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
export async function addWatchlistItem(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));
  const name = String(formData.get("name") ?? "").trim();

  if (!symbol) return { ok: false, error: "Symbol is required." };
  if (!name) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("watchlist").insert({ symbol, name });
  if (error) return { ok: false, error: friendly(error) };

  revalidatePath("/watchlist");
  revalidatePath("/");
  return { ok: true };
}

export async function updateWatchlistItem(formData: FormData): Promise<ActionResult> {
  const symbol = normaliseSymbol(formData.get("symbol"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name cannot be empty." };

  const supabase = await createClient();
  const { error } = await supabase.from("watchlist").update({ name }).eq("symbol", symbol);
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
  const budget = Number(String(formData.get("budget") ?? ""));
  const maxWeightPct = Number(String(formData.get("max_weight_pct") ?? ""));
  const limitBufferPct = Number(String(formData.get("limit_buffer_pct") ?? ""));

  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, error: "Budget must be a positive number." };
  }
  if (!Number.isFinite(maxWeightPct) || maxWeightPct <= 0 || maxWeightPct > 100) {
    return { ok: false, error: "Concentration cap must be between 0 and 100." };
  }
  if (!Number.isFinite(limitBufferPct) || limitBufferPct < 0 || limitBufferPct > 5) {
    return { ok: false, error: "Limit buffer must be between 0 and 5 percent." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      budget,
      max_weight_pct: maxWeightPct,
      limit_buffer_pct: limitBufferPct,
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
