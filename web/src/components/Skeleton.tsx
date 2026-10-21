/**
 * Loading skeletons.
 *
 * Shaped like the real screens so the page doesn't jump when data arrives —
 * the point is to show structure, not to entertain. The shimmer is disabled
 * under prefers-reduced-motion by the rule in globals.css.
 */

import { Page } from "@/components/AppShell";

export function Bar({ w = "100%", h = 12, round = false }: { w?: string; h?: number; round?: boolean }) {
  return (
    <span
      className={`skeleton block ${round ? "rounded-full" : "rounded-md"}`}
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  );
}

function Shell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card ${className}`}>
      {children}
    </div>
  );
}

/** A card header followed by broker-style rows. */
export function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Shell>
      <div className="border-b border-hairline px-4 py-3.5 sm:px-5">
        <Bar w="30%" h={14} />
        <div className="mt-2">
          <Bar w="72%" h={10} />
        </div>
      </div>
      <div className="rows">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="space-y-2 px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <Bar w="38%" h={14} />
              <Bar w="3.5rem" h={14} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Bar w="55%" h={10} />
              <Bar w="4.5rem" h={10} />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** Advisor: status strip, today's pick, ranking. */
export function AdvisorSkeleton() {
  return (
    <Page>
      <div className="flex items-center justify-between px-1">
        <Bar w="11rem" h={12} />
        <Bar w="6rem" h={36} round />
      </div>
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-3 sm:space-y-4">
          <Shell>
            <div className="p-4 sm:p-5">
              <Bar w="7rem" h={14} />
              <div className="mt-4 flex items-end justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <Bar w="55%" h={28} />
                  <Bar w="75%" h={12} />
                </div>
                <Bar w="4.5rem" h={28} />
              </div>
              <div className="mt-5">
                <Bar w="100%" h={68} />
              </div>
              <div className="mt-3">
                <Bar w="100%" h={44} />
              </div>
            </div>
            <div className="space-y-4 border-t border-hairline p-4 sm:p-5">
              {[0, 1].map((i) => (
                <div key={i} className="space-y-2">
                  <Bar w="40%" h={12} />
                  <Bar w="100%" h={6} round />
                </div>
              ))}
            </div>
          </Shell>
          <ListCardSkeleton rows={5} />
        </div>
        <div className="hidden lg:block">
          <Shell>
            <div className="space-y-3 p-5">
              <Bar w="5rem" h={10} />
              <Bar w="60%" h={28} />
              <Bar w="40%" h={12} />
            </div>
          </Shell>
        </div>
      </div>
    </Page>
  );
}

/** Portfolio: the current-value headline, then holdings. */
export function PortfolioSkeleton() {
  return (
    <Page>
      <Shell>
        <div className="p-4 sm:p-6">
          <Bar w="6rem" h={10} />
          <div className="mt-3">
            <Bar w="55%" h={40} />
          </div>
          <div className="mt-3">
            <Bar w="35%" h={14} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`space-y-2 ${i === 2 ? "hidden sm:block" : ""}`}>
                <Bar w="50%" h={10} />
                <Bar w="70%" h={18} />
              </div>
            ))}
          </div>
        </div>
      </Shell>
      <ListCardSkeleton rows={6} />
    </Page>
  );
}

/** Watchlist and Settings: a summary card, then a list. */
export function FormPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Page width="narrow">
      <Shell>
        <div className="space-y-3 p-4 sm:p-5">
          <Bar w="6rem" h={10} />
          <Bar w="45%" h={28} />
          <Bar w="100%" h={8} round />
        </div>
      </Shell>
      <ListCardSkeleton rows={rows} />
    </Page>
  );
}
