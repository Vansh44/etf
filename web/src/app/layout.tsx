import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getSessionEmail } from "@/lib/supabase/server";

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
// the nav then pads for via env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = await getSessionEmail();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        {email && <Nav email={email} />}
        {/* Bottom padding clears the fixed mobile tab bar (56px + safe area). */}
        <div
          className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0"
          style={email ? undefined : { paddingBottom: 0 }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
