import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { THEME_COLOR, THEME_COOKIE, parseTheme } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ETF Advisor",
  description: "Which ETF is cheapest right now, and how many units to buy.",
  // Personal financial data — keep it out of search engines.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "ETF Advisor", statusBarStyle: "default" },
};

// Lets the layout fill the screen behind the notch and home indicator, which
// the nav then pads for via env(safe-area-inset-*). The browser's own chrome
// takes the header's colour in each theme; a manual override repaints these
// tags — see applyTheme in lib/theme.ts.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Stamped on the server so an overridden theme is right on the first paint.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
