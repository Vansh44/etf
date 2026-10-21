"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  AdvisorIcon,
  BrandMark,
  PortfolioIcon,
  SettingsIcon,
  SignOutIcon,
  WatchlistIcon,
} from "@/components/icons";

/**
 * Mobile-first navigation.
 *
 * Phones get a fixed bottom tab bar — the thumb zone — and a header that just
 * names the screen. Tablets and desktops get the tabs inline in the header,
 * where a cursor already is. The bar sits above the iOS home indicator via
 * safe-area-inset-bottom; AppShell pads the content to match.
 *
 * `base` prefixes every link, so the sample-data preview under /preview
 * navigates between its own pages rather than the real, signed-in ones.
 */

const LINKS = [
  { href: "/", label: "Advisor", Icon: AdvisorIcon },
  { href: "/portfolio", label: "Portfolio", Icon: PortfolioIcon },
  { href: "/watchlist", label: "Watchlist", Icon: WatchlistIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Nav({ email, base = "" }: { email: string; base?: string }) {
  const fullPath = usePathname();
  const path = (base && fullPath.startsWith(base) ? fullPath.slice(base.length) : fullPath) || "/";
  const current = LINKS.find((l) => isActive(path, l.href));
  const to = (href: string) => (base ? `${base}${href === "/" ? "" : href}` : href);

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-hairline backdrop-blur-xl"
        style={{
          background: "color-mix(in srgb, var(--surface) 86%, transparent)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href={to("/")} className="flex min-h-11 shrink-0 items-center gap-2.5">
            <BrandMark size={30} />
            {/* Phones show the screen's name; wider screens the product's. */}
            <span className="text-[17px] font-semibold tracking-tight sm:hidden">
              {current?.label ?? "ETF Advisor"}
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">ETF Advisor</span>
          </Link>

          <nav className="ml-4 hidden h-14 items-stretch gap-1 sm:flex" aria-label="Main">
            {LINKS.map(({ href, label }) => {
              const active = isActive(path, href);
              return (
                <Link
                  key={href}
                  href={to(href)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center px-3 text-sm font-medium transition ${
                    active ? "text-accent" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {label}
                  {active && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu email={email} settingsHref={to("/settings")} />
          </div>
        </div>
      </header>

      {/* Bottom tab bar — phones only. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline backdrop-blur-xl sm:hidden"
        style={{
          background: "color-mix(in srgb, var(--surface) 92%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label="Main"
      >
        <div className="flex h-16">
          {LINKS.map(({ href, label, Icon }) => {
            const active = isActive(path, href);
            return (
              <Link
                key={href}
                href={to(href)}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition active:scale-95 ${
                  active ? "text-accent" : "text-ink-2"
                }`}
              >
                <span
                  className={`grid h-7 w-14 place-items-center rounded-full transition ${
                    active ? "bg-accent-soft" : ""
                  }`}
                >
                  <Icon className="h-[22px] w-[22px]" />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/** Avatar button with the signed-in email, Settings and Sign out. */
function AccountMenu({ email, settingsHref }: { email: string; settingsHref: string }) {
  const ref = useRef<HTMLDetailsElement>(null);

  // A <details> menu stays open until toggled. Close it on any tap outside,
  // and on Escape, like every other menu on the phone.
  useEffect(() => {
    const close = (event: Event) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-surface-2 active:scale-95"
        aria-label="Account"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold uppercase text-accent">
          {email.slice(0, 1)}
        </span>
      </summary>
      <div className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-pop">
        <div className="border-b border-hairline px-4 py-3">
          <p className="text-xs text-ink-2">Signed in as</p>
          <p className="truncate text-sm font-medium">{email}</p>
        </div>
        <Link
          href={settingsHref}
          onClick={() => ref.current?.removeAttribute("open")}
          className="flex min-h-11 items-center gap-3 px-4 text-sm hover:bg-surface-2"
        >
          <SettingsIcon className="h-[18px] w-[18px] text-ink-2" />
          Settings
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-3 px-4 text-sm text-loss hover:bg-loss-soft"
          >
            <SignOutIcon className="h-[18px] w-[18px]" />
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
