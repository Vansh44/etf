/**
 * Shared presentation pieces.
 *
 * Rules enforced here rather than left to each page:
 *  1. A delta never relies on colour alone — Delta always renders a sign and an
 *     arrow, because gain-green and loss-red are near-identical to red-green
 *     colourblind readers.
 *  2. Big standalone values use proportional figures; only columns that must
 *     align vertically get tabular-nums.
 *  3. Every tap target is at least 44px tall on a phone.
 */

import { AlertIcon, BlockIcon, InfoIcon } from "@/components/icons";

// ─── formatting ─────────────────────────────────────────────────────────────

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
 * Signed rupee amount: "+₹529", "−₹192".
 *
 * The sign goes BEFORE the currency, never inside it — "₹-192" reads as a
 * typo. Uses a real minus (−) rather than a hyphen so it lines up with digits.
 */
export function signedRupee(n: number, opts: { compact?: boolean; dp?: number } = {}): string {
  const sign = n < 0 ? "−" : "+";
  const body = opts.compact ? compact(n) : rupee(Math.abs(n), opts.dp ?? 0);
  return `${sign}₹${body}`;
}

/** "+1.25%", "−0.40%". */
export const signedPct = (n: number, dp = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(dp)}%`;

/** "today, 2:30 pm" or "21 Oct, 3:45 pm" — always Indian time, whatever the server's zone. */
export function istStamp(iso: string, nowMs = Date.now()): string {
  const at = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const time = at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  if (day(at) === day(new Date(nowMs))) return `today, ${time}`;
  const date = at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  return `${date}, ${time}`;
}

/** "21 Oct" from an ISO yyyy-mm-dd. */
export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

// ─── buttons and fields ─────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const base =
    "inline-flex select-none items-center justify-center gap-2 font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55";
  const sizes = {
    md: "min-h-11 rounded-xl px-4 text-sm",
    sm: "min-h-9 rounded-lg px-3 text-[13px]",
  }[size];
  const variants = {
    primary: "bg-accent text-accent-ink hover:brightness-110",
    secondary: "border border-hairline-strong bg-surface text-ink hover:bg-surface-2",
    ghost: "text-accent hover:bg-accent-soft",
    danger: "text-loss hover:bg-loss-soft",
  }[variant];
  return `${base} ${sizes} ${variants}`;
}

/** Text and number inputs. Width is left to the caller. */
export const inputClass =
  "min-h-11 rounded-xl border border-hairline-strong bg-surface-2 px-3.5 text-ink transition placeholder:text-ink-2 focus:border-accent focus:bg-surface focus:outline-none focus-visible:outline-none focus:ring-3 focus:ring-accent-soft";

// ─── layout ─────────────────────────────────────────────────────────────────

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
    <Tag className={`rounded-2xl border border-hairline bg-surface shadow-card ${className}`}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  hint,
  right,
  count,
}: {
  title: string;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          {title}
          {count !== undefined && (
            <span className="tnum rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">
              {count}
            </span>
          )}
        </h2>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{hint}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Small uppercase label above a value or a group. */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 ${className}`}>
      {children}
    </p>
  );
}

// ─── values ─────────────────────────────────────────────────────────────────

/**
 * Signed change. Sign + arrow always present, so the direction survives
 * greyscale, colourblindness and forced-colors mode.
 */
export function Delta({
  value,
  pct,
  size = "sm",
  /** Show only the percentage — for places whose value already states the amount. */
  pctOnly = false,
  dp = 2,
}: {
  value: number | null;
  pct?: number | null;
  size?: "xs" | "sm" | "lg";
  pctOnly?: boolean;
  dp?: number;
}) {
  if (value === null) return <span className="tnum text-ink-2">—</span>;

  const up = value >= 0;
  const hasPct = pct !== null && pct !== undefined;
  const sizeClass = { xs: "text-xs", sm: "text-sm", lg: "text-base sm:text-lg" }[size];

  return (
    <span
      className={`tnum inline-flex items-baseline gap-1 font-semibold ${sizeClass} ${
        up ? "text-gain" : "text-loss"
      }`}
    >
      <span aria-hidden="true" className="text-[0.75em]">
        {up ? "▲" : "▼"}
      </span>
      {pctOnly && hasPct ? (
        <span>{signedPct(pct, dp)}</span>
      ) : (
        <>
          <span>{signedRupee(value, { dp })}</span>
          {hasPct && <span className="font-medium opacity-90">({signedPct(pct, dp)})</span>}
        </>
      )}
      <span className="sr-only">{up ? "gain" : "loss"}</span>
    </span>
  );
}

/** Label · value · optional sub-line or delta. No plot, so no hover layer. */
export function Stat({
  label,
  value,
  sub,
  delta,
  size = "md",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const valueClass = {
    sm: "text-[15px]",
    md: "text-lg sm:text-xl",
    lg: "text-2xl sm:text-3xl",
  }[size];
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className={`figure mt-0.5 truncate font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
      {delta && <div className="mt-0.5">{delta}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "gain" | "loss" | "warn";
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 border-hairline",
    accent: "bg-accent-soft text-accent border-transparent",
    gain: "bg-gain-soft text-gain border-transparent",
    loss: "bg-loss-soft text-loss border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
  }[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${tones}`}
    >
      {children}
    </span>
  );
}

/** Row of label/value pairs — stacks on narrow screens instead of overflowing. */
export function DefRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-ink-2">{k}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium">{v}</dd>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-2">{children}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Status message. Always an icon and words, never colour alone. */
export function Banner({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn" | "error";
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: { box: "bg-accent-soft", icon: "text-accent", Icon: InfoIcon },
    warn: { box: "bg-warn-soft", icon: "text-warn", Icon: AlertIcon },
    error: { box: "bg-loss-soft", icon: "text-loss", Icon: BlockIcon },
  }[tone];
  const { Icon } = styles;
  return (
    <div className={`flex gap-3 rounded-2xl px-4 py-3.5 ${styles.box}`} role={tone === "info" ? undefined : "status"}>
      <span className={`mt-0.5 ${styles.icon}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 text-sm leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5 text-ink-2" : ""}>{children}</div>
      </div>
    </div>
  );
}

// ─── meters ─────────────────────────────────────────────────────────────────

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * A 0-100 mark. One hue: the fill is the accent, the track a lighter step of
 * the same ramp, so the state reads across the whole bar.
 */
export function MarkBar({ value, label, className = "" }: { value: number; label: string; className?: string }) {
  const pct = clamp(value);
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-meter-track ${className}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Current weight as a fill, target as a tick. Every bar in a list shares
 * `scaleMax`, so their lengths are comparable with each other.
 */
export function WeightBar({
  current,
  target,
  scaleMax,
  label,
}: {
  current: number;
  target: number | null;
  scaleMax: number;
  label: string;
}) {
  const max = Math.max(scaleMax, current, target ?? 0, 1);
  const fill = clamp((current / max) * 100);
  const tick = target === null ? null : clamp((target / max) * 100);
  return (
    <div className="relative h-1.5 rounded-full bg-meter-track" role="img" aria-label={label}>
      <div className="h-full rounded-full bg-meter-fill" style={{ width: `${fill}%` }} />
      {tick !== null && (
        <span
          className="absolute -top-[5px] h-4 w-[3px] rounded-full border border-surface bg-ink"
          style={{ left: `calc(${tick}% - 1.5px)` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
