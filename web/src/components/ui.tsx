/**
 * Shared presentation pieces.
 *
 * Two rules enforced here rather than left to each page:
 *  1. A delta never relies on colour alone — Delta always renders a sign and an
 *     arrow, because gain-green and loss-red are near-identical to red-green
 *     colourblind readers (measured protan ΔE 4.6).
 *  2. Big standalone values use proportional figures; only columns that must
 *     align vertically get tabular-nums.
 */

export const rupee = (n: number, dp = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const rupee0 = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Compact for tiles: 1.2L, 45.6K — Indian units, since the values are in rupees. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)}K`;
  return abs.toFixed(0);
}

/**
 * Signed rupee amount for a tile value: "+Rs.529", "−Rs.192".
 *
 * The sign goes BEFORE the currency, never inside it — "Rs.-192" reads as a
 * typo. Uses a real minus (−) rather than a hyphen so it lines up with digits.
 */
export function signedRupee(n: number, opts: { compact?: boolean } = {}): string {
  const sign = n < 0 ? "−" : "+";
  const body = opts.compact ? compact(n) : rupee0(Math.abs(n));
  return `${sign}Rs.${body}`;
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag
      className={`rounded-2xl border bg-[var(--surface)] ${className}`}
      style={{ borderColor: "var(--hairline)" }}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
        {hint && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            {hint}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

/**
 * Signed change. Sign + arrow always present, so the direction survives
 * greyscale, colourblindness and forced-colors mode.
 */
export function Delta({
  value,
  pct,
  size = "sm",
  prefix = "Rs.",
  /** Show only the percentage — for tiles whose value already states the amount. */
  pctOnly = false,
}: {
  value: number | null;
  pct?: number | null;
  size?: "sm" | "lg";
  prefix?: string;
  pctOnly?: boolean;
}) {
  if (value === null) {
    return (
      <span className="tnum" style={{ color: "var(--ink-2)" }}>
        —
      </span>
    );
  }
  const up = value >= 0;
  const sign = up ? "+" : "−";
  const hasPct = pct !== null && pct !== undefined;

  return (
    <span
      className={`tnum inline-flex items-baseline gap-1 font-semibold ${
        size === "lg" ? "text-lg sm:text-xl" : "text-sm"
      }`}
      style={{ color: up ? "var(--gain)" : "var(--loss)" }}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {pctOnly && hasPct ? (
        <span>
          {sign}
          {Math.abs(pct).toFixed(2)}%
        </span>
      ) : (
        <>
          <span>
            {sign}
            {prefix}
            {rupee(Math.abs(value))}
          </span>
          {hasPct && (
            <span className="font-normal opacity-90">
              ({sign}
              {Math.abs(pct).toFixed(2)}%)
            </span>
          )}
        </>
      )}
      <span className="sr-only">{up ? "gain" : "loss"}</span>
    </span>
  );
}

/** Stat tile: label · value · optional delta. No plot, so no hover layer. */
export function StatTile({
  label,
  value,
  sub,
  delta,
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: React.ReactNode;
  hero?: boolean;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ borderColor: "var(--hairline)", background: "var(--plane)" }}
    >
      <p className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
        {label}
      </p>
      <p
        className={`figure mt-1 font-semibold ${
          hero ? "text-3xl sm:text-5xl" : "text-xl sm:text-2xl"
        }`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
          {sub}
        </p>
      )}
      {delta && <div className="mt-1.5">{delta}</div>}
    </div>
  );
}

/**
 * Cheapness meter. Sequential single hue; the unfilled track is a lighter step
 * of the same ramp so the state reads across the whole bar.
 */
export function Meter({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full sm:w-20"
        style={{ background: "var(--meter-track)" }}
        role="img"
        aria-label={label ?? `${pct.toFixed(0)} out of 100`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--meter-fill)" }}
        />
      </div>
      <span className="tnum text-sm font-semibold">{value.toFixed(1)}</span>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "gain" | "loss";
}) {
  const styles = {
    neutral: { background: "var(--plane)", color: "var(--ink-2)", borderColor: "var(--hairline)" },
    accent: { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" },
    gain: { background: "var(--gain-soft)", color: "var(--gain)", borderColor: "transparent" },
    loss: { background: "var(--loss-soft)", color: "var(--loss)", borderColor: "transparent" },
  }[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
      style={styles}
    >
      {children}
    </span>
  );
}

/** Row of label/value pairs — stacks on narrow screens instead of overflowing. */
export function DefRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs sm:w-28 sm:text-sm" style={{ color: "var(--ink-2)" }}>
        {k}
      </dt>
      <dd className="min-w-0 text-sm">{v}</dd>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: "var(--ink-2)" }}>
        {children}
      </p>
    </div>
  );
}
