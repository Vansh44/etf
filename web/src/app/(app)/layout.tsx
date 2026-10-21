import { AppShell } from "@/components/AppShell";
import { getSessionEmail } from "@/lib/supabase/server";

/**
 * Every signed-in screen. The proxy has already bounced anyone without a
 * session to /login, so an email is expected here; without one the page
 * still renders, just with no navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await getSessionEmail();
  if (!email) return <>{children}</>;
  return <AppShell email={email}>{children}</AppShell>;
}
