import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { SettingsView } from "@/components/views/SettingsView";
import { PREVIEW_EMAIL, PREVIEW_EMAILS, parseState, previewSettings } from "../fixtures";

export default async function PreviewSettings({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const state = parseState((await searchParams).state);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <SettingsView settings={previewSettings(state)} emails={PREVIEW_EMAILS} me={PREVIEW_EMAIL} theme={theme} />;
}
