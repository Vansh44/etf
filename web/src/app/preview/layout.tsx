import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PREVIEW_EMAIL } from "./fixtures";

/**
 * Design preview: every screen rendered from sample data, with no database and
 * no sign-in, so the UI can be checked on a phone-sized viewport locally.
 * `next dev` only — a production build serves a 404 here, and the proxy lets
 * /preview through unauthenticated only in development.
 */

export const dynamic = "force-dynamic";

const STATES = [
  { state: "", label: "Normal" },
  { state: "warn", label: "Warning" },
  { state: "overbudget", label: "Over budget" },
  { state: "nobuy", label: "No buy" },
  { state: "stale", label: "Stale" },
  { state: "empty", label: "Empty" },
];

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <AppShell email={PREVIEW_EMAIL} base="/preview">
      <div className="border-b border-hairline bg-warn-soft">
        <div className="mx-auto flex max-w-6xl items-center gap-3 overflow-x-auto px-4 py-2 text-xs sm:px-6">
          <span className="shrink-0 font-semibold text-warn">Preview · sample data</span>
          {STATES.map(({ state, label }) => (
            <Link
              key={label}
              href={state ? `?state=${state}` : "?"}
              className="shrink-0 rounded-full px-2 py-1 font-medium text-ink-2 hover:bg-surface hover:text-ink"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </AppShell>
  );
}
