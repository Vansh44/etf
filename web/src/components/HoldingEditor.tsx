"use client";

import { useEffect, useRef, useState } from "react";
import { deleteHolding, recordBuy, upsertHolding } from "@/app/actions";
import { afterBuy } from "@/lib/valuation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { inputClass, rupee } from "@/components/ui";

/**
 * The form inside a Portfolio row. Two ways in, because they are two jobs:
 *
 *   Record a buy  what you just bought, at what price. The new total and the
 *                 weighted average are worked out for you — the common case,
 *                 straight after placing the Advisor's order.
 *   Set totals    the numbers outright, for corrections and sells.
 */

type Mode = "buy" | "set";

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "buy", label: "Record a buy" },
  { value: "set", label: "Set totals" },
];

const FIELDS = "grid grid-cols-2 gap-3 sm:grid-cols-[8rem_10rem_max-content] sm:items-end";
const LABEL = "mb-1.5 block text-xs font-medium text-ink-2";

export function HoldingEditor({
  symbol,
  units,
  avgPrice,
  livePrice,
  onWatchlist,
}: {
  symbol: string;
  units: number;
  avgPrice: number | null;
  livePrice: number | null;
  onWatchlist: boolean;
}) {
  const [mode, setMode] = useState<Mode>("buy");
  const [bought, setBought] = useState("");
  const [price, setPrice] = useState("");
  const root = useRef<HTMLDivElement>(null);

  // The Advisor's pick card links to #SYMBOL: arrive with this row open.
  useEffect(() => {
    if (window.location.hash !== `#${symbol}`) return;
    const row = root.current?.closest("details");
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ block: "center" });
  }, [symbol]);

  const qty = Number(bought);
  const paid = Number(price);
  const next =
    Number.isInteger(qty) && qty >= 1 && Number.isFinite(paid) && paid > 0
      ? afterBuy({ units, avgPrice }, qty, paid)
      : null;

  return (
    <div ref={root} className="space-y-3">
      <div
        role="radiogroup"
        aria-label={`How to update ${symbol}`}
        className="grid grid-cols-2 gap-1 rounded-xl border border-hairline bg-surface-2 p-1 sm:max-w-xs"
      >
        {MODES.map((option) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option.value)}
              className={`min-h-10 rounded-lg text-sm font-medium transition ${
                selected ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {mode === "buy" ? (
        <ActionForm
          action={recordBuy}
          collapseOnSuccess
          onSuccess={() => {
            setBought("");
            setPrice("");
          }}
        >
          <input type="hidden" name="symbol" value={symbol} />
          <div className={FIELDS}>
            <label className="block">
              <span className={LABEL}>Units bought</span>
              <input
                name="units"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                required
                value={bought}
                onChange={(e) => setBought(e.target.value)}
                placeholder="0"
                aria-label={`Units of ${symbol} bought`}
                className={`${inputClass} tnum w-full`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Price per unit</span>
              <input
                name="price"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={livePrice !== null ? livePrice.toFixed(2) : "0.00"}
                aria-label={`Price paid per unit of ${symbol}`}
                className={`${inputClass} tnum w-full`}
              />
            </label>
            <SubmitButton pendingText="Saving…" className="col-span-2 w-full sm:col-span-1 sm:w-auto">
              Record buy
            </SubmitButton>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-2" aria-live="polite">
            {next ? (
              <>
                You&apos;ll hold <strong className="tnum font-semibold text-ink">{next.units} units</strong>
                {next.avgPrice !== null ? (
                  <>
                    {" "}
                    at an average of <strong className="tnum font-semibold text-ink">₹{rupee(next.avgPrice)}</strong>.
                  </>
                ) : (
                  <>. The average stays unknown until you set one under Set totals.</>
                )}
              </>
            ) : units > 0 ? (
              <>
                You hold {units}
                {avgPrice !== null && <> at an average of ₹{rupee(avgPrice)}</>}. Enter the buy and the new average
                is worked out for you.
              </>
            ) : (
              <>Not bought yet. Enter your first buy — the price you paid, as the order filled.</>
            )}
          </p>
        </ActionForm>
      ) : (
        // Keyed on the stored values, so a save that changes them refills the fields.
        <ActionForm key={`${units}:${avgPrice}`} action={upsertHolding} collapseOnSuccess>
          <input type="hidden" name="symbol" value={symbol} />
          <div className={FIELDS}>
            <label className="block">
              <span className={LABEL}>Total units</span>
              <input
                name="units"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                required
                defaultValue={units}
                aria-label={`Total units of ${symbol}`}
                className={`${inputClass} tnum w-full`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Average price</span>
              <input
                name="avg_price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                defaultValue={avgPrice !== null ? avgPrice.toFixed(2) : ""}
                placeholder={units === 0 ? "0.00" : "unknown"}
                aria-label={`Average price of ${symbol}`}
                className={`${inputClass} tnum w-full`}
              />
            </label>
            <SubmitButton pendingText="Saving…" className="col-span-2 w-full sm:col-span-1 sm:w-auto">
              Save
            </SubmitButton>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-2">
            For corrections and sells. Leave the average blank if you don&apos;t know it.
          </p>
        </ActionForm>
      )}

      {/* A watchlist ETF always has a row; zero units is how it's cleared. */}
      {!onWatchlist && (
        <ActionForm
          action={deleteHolding}
          confirm={`Remove ${symbol} from your records? This only edits this app — it does not sell anything.`}
        >
          <input type="hidden" name="symbol" value={symbol} />
          <SubmitButton variant="danger" size="sm" pendingText="Removing…">
            Remove {symbol}
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
