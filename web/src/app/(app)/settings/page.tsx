import { cookies } from "next/headers";
import { getAllowedEmails, getSettings } from "@/lib/data";
import { getSessionEmail, isAllowed } from "@/lib/supabase/server";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { SettingsView } from "@/components/views/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [settings, emails, me, cookieStore] = await Promise.all([
    getSettings(),
    getAllowedEmails(),
    getSessionEmail(),
    cookies(),
  ]);

  return (
    <SettingsView
      settings={settings}
      emails={emails}
      me={me}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
    />
  );
}
