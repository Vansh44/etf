"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile-first navigation.
 *
 * Phones get a fixed bottom tab bar — the thumb zone — because top tabs on a
 * tall phone are the hardest place on the screen to reach one-handed. Tablets
 * and desktops get the tabs inline in the header, where a cursor already is.
 *
 * The bar sits above the iOS home indicator via safe-area-inset-bottom, and
 * <body> carries matching bottom padding so nothing hides underneath it.
 */

type Item = { href: string; label: string; icon: React.ReactNode };

const ICON = "h-5 w-5";

const LINKS: Item[] = [
  {
    href: "/",
    label: "Advisor",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M17 7h4v4" />
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.8 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6.2 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1.17 2.8l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 13v.09Z" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <>
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-md"
        style={{
          borderColor: "var(--hairline)",
          background: "color-mix(in srgb, var(--surface) 85%, transparent)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-3 sm:px-6">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              aria-hidden="true"
            >
              ₹
            </span>
            <span className="text-sm font-semibold sm:text-base">ETF Advisor</span>
          </Link>

          {/* Inline tabs from sm up; phones use the bottom bar instead. */}
          <nav className="hidden flex-1 gap-1 sm:flex">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition"
                  style={
                    active
                      ? { background: "var(--accent)", color: "var(--accent-ink)" }
                      : { color: "var(--ink-2)" }
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              className="hidden max-w-[14rem] truncate text-xs md:inline"
              style={{ color: "var(--ink-2)" }}
            >
              {email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="min-h-11 rounded-lg border px-3 text-xs font-medium"
                style={{ borderColor: "var(--hairline)" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Bottom tab bar — phones only. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md sm:hidden"
        style={{
          borderColor: "var(--hairline)",
          background: "color-mix(in srgb, var(--surface) 94%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label="Main"
      >
        <div className="flex">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium"
                style={{ color: active ? "var(--accent)" : "var(--ink-2)" }}
              >
                {link.icon}
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
