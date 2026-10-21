/**
 * Light / dark theme choice.
 *
 * "system" follows the phone or OS. "light" and "dark" override it by stamping
 * <html data-theme>, which globals.css keys every token on. The choice lives in
 * a cookie rather than localStorage so the server can stamp the attribute on
 * the first paint — no flash of the wrong theme, and no inline script.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_COOKIE = "theme";

/** The header surface in each theme, for the browser's own chrome. */
export const THEME_COLOR = { light: "#ffffff", dark: "#15171b" } as const;

export function parseTheme(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** Client only. Applies the choice now and remembers it for a year. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  // Elements with colour transitions would otherwise fade into the new theme
  // at their own pace while the rest flips instantly. Hold every transition
  // for the frame the tokens change in.
  root.classList.add("theme-switching");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));

  if (choice === "system") {
    delete root.dataset.theme;
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } else {
    root.dataset.theme = choice;
    document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
  }

  // The status bar / address bar colour comes from <meta name="theme-color">,
  // one per colour scheme. An override has to repaint both, or the browser
  // chrome would keep following the OS while the page does not.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLOR[choice === "system" ? scheme : choice];
  });
}

/** Client only. The theme actually on screen right now. */
export function effectiveTheme(): "light" | "dark" {
  const stamped = document.documentElement.dataset.theme;
  if (stamped === "light" || stamped === "dark") return stamped;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
