"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Advisor" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{ borderColor: "var(--hairline)", background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}
    >
      <div className="mx-auto max-w-6xl px-3 sm:px-6">
        {/* Top line: brand + account. */}
        <div className="flex h-14 items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              aria-hidden="true"
            >
              ₹
            </span>
            <span className="text-sm sm:text-base">ETF Advisor</span>
          </Link>

          <div className="flex items-center gap-2">
            <span
              className="hidden max-w-[16rem] truncate text-xs sm:inline"
              style={{ color: "var(--ink-2)" }}
            >
              {email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="min-h-9 rounded-lg border px-3 text-xs font-medium"
                style={{ borderColor: "var(--hairline)" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Tabs. Scroll horizontally on very narrow phones rather than wrapping
            into a second row that pushes content down. */}
        <nav
          className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0"
          style={{ scrollbarWidth: "none" }}
        >
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="min-h-9 shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition"
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
      </div>
    </header>
  );
}
