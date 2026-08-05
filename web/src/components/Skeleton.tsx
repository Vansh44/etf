/**
 * Loading skeletons.
 *
 * Shaped like the real content so the page doesn't jump when data arrives —
 * the point is to show structure, not to entertain. The shimmer is disabled
 * under prefers-reduced-motion by the rule in globals.css.
 */

export function Bar({ w = "100%", h = 12 }: { w?: string; h?: number }) {
  return (
    <span
      className="skeleton block rounded-md"
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border"
      style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
    >
      {children}
    </div>
  );
}

function TileSkeleton() {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ borderColor: "var(--hairline)", background: "var(--plane)" }}
    >
      <Bar w="55%" h={10} />
      <div className="mt-2">
        <Bar w="75%" h={22} />
      </div>
    </div>
  );
}

/** Rows of tiles — matches the KPI grids. */
export function TileGridSkeleton({ count = 4, cols = 4 }: { count?: number; cols?: 3 | 4 }) {
  return (
    <div
      className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${
        cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"
      }`}
    >
      {Array.from({ length: count }, (_, i) => (
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

/** Card with a header and a list of rows — matches ranking / holdings. */
export function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Shell>
      <div className="border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--hairline)" }}>
        <Bar w="38%" h={14} />
        <div className="mt-2">
          <Bar w="70%" h={10} />
        </div>
      </div>
      <div className="rows">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <Bar w="6rem" h={14} />
            <span className="flex-1" />
            <span className="hidden sm:block">
              <Bar w="4rem" h={12} />
            </span>
            <Bar w="3.5rem" h={12} />
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** The Advisor page's own shape: run bar, recommendation, ranking. */
export function AdvisorSkeleton() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <Shell>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0 flex-1">
            <Bar w="60%" h={18} />
            <div className="mt-2">
              <Bar w="80%" h={11} />
            </div>
          </div>
          <Bar w="12rem" h={44} />
        </div>
      </Shell>

      <Shell>
        <div className="p-4 sm:p-5">
          <Bar w="4rem" h={18} />
          <div className="mt-3">
            <Bar w="45%" h={26} />
          </div>
          <div className="mt-1.5">
            <Bar w="70%" h={12} />
          </div>
          <div className="mt-4">
            <TileGridSkeleton count={3} cols={3} />
          </div>
          <div className="mt-4 space-y-2">
            <Bar w="90%" h={12} />
            <Bar w="75%" h={12} />
            <Bar w="60%" h={12} />
          </div>
        </div>
      </Shell>

      <ListCardSkeleton rows={6} />
    </main>
  );
}

/** The Portfolio page's shape: hero value, tiles, holdings. */
export function PortfolioSkeleton() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <Shell>
        <div className="p-4 sm:p-5">
          <Bar w="6rem" h={10} />
          <div className="mt-2">
            <Bar w="55%" h={40} />
          </div>
          <div className="mt-3">
            <Bar w="40%" h={16} />
          </div>
          <div className="mt-4">
            <TileGridSkeleton count={3} cols={3} />
          </div>
        </div>
      </Shell>
      <ListCardSkeleton rows={6} />
    </main>
  );
}

/** Generic form-ish page: watchlist and settings. */
export function FormPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <Shell>
        <div className="border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--hairline)" }}>
          <Bar w="30%" h={14} />
          <div className="mt-2">
            <Bar w="85%" h={10} />
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:p-5">
          <Bar w="100%" h={44} />
          <Bar w="100%" h={44} />
          <Bar w="5rem" h={44} />
        </div>
      </Shell>
      <ListCardSkeleton rows={rows} />
    </main>
  );
}
