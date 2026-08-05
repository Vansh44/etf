import { getAllowedEmails, getSettings } from "@/lib/data";
import { getSessionEmail, isAllowed } from "@/lib/supabase/server";
import { addAllowedEmail, removeAllowedEmail, updateSettings } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";
import { Card, CardHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const input =
  "w-40 min-h-11 rounded-xl border px-3 text-sm tnum bg-[var(--surface)] focus:outline-2 focus:outline-offset-1";
const inputStyle = { borderColor: "var(--hairline)", outlineColor: "var(--accent)" };

export default async function SettingsPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [settings, emails, me] = await Promise.all([
    getSettings(),
    getAllowedEmails(),
    getSessionEmail(),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-3 pb-16 sm:space-y-5 sm:p-6">
      {/* ── strategy settings ──────────────────────────────────── */}
      <Card>
        <CardHeader title="Strategy" hint="How much to spend, how hard to chase your target allocations, and when to refuse the data." />
        <ActionForm action={updateSettings} className="space-y-4 p-4 sm:p-5">
          <Field
            label="Budget (Rs. per run)"
            hint="How much to spend each time. Nothing tracks how often you run it."
          >
            <input
              name="budget"
              type="number"
              min="1"
              step="1"
              defaultValue={settings.budget}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Gap weight"
            hint="How hard the allocation gap pulls. Score = cheapness + this × (target − current), in percentage points. 0 ignores targets entirely; 5 makes them dominate."
          >
            <input
              name="gap_weight"
              type="number"
              min="0"
              max="20"
              step="0.1"
              defaultValue={settings.gapWeight}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Max premium over NAV (%)"
            hint="Refuse an ETF trading this far above the value of its holdings. International ETFs can run to +16% when funds hit the SEBI overseas cap."
          >
            <input
              name="max_premium_pct"
              type="number"
              min="0"
              max="50"
              step="0.1"
              defaultValue={settings.maxPremiumPct}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Minimum history (sessions)"
            hint="Cheapness is scored on a 252-session window, so 252 is the honest floor. Lower it and shorter histories are admitted with a proportionally reduced confidence."
          >
            <input
              name="min_candles"
              type="number"
              min="60"
              max="500"
              step="1"
              defaultValue={settings.minCandles}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Max price age (days)"
            hint="Refuse to recommend anything if the newest price is older than this — it means the fetcher missed a trading session."
          >
            <input
              name="max_bar_age_days"
              type="number"
              min="1"
              max="30"
              step="1"
              defaultValue={settings.maxBarAgeDays}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Max NAV age (days)"
            hint="Ignore a NAV older than this rather than trusting it. International ETFs legitimately publish NAV a day late."
          >
            <input
              name="max_nav_age_days"
              type="number"
              min="1"
              max="30"
              step="1"
              defaultValue={settings.maxNavAgeDays}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Limit buffer (%)"
            hint="Suggested limit price sits this far above the live price so the order can fill."
          >
            <input
              name="limit_buffer_pct"
              type="number"
              min="0"
              max="5"
              step="0.05"
              defaultValue={settings.limitBufferPct}
              required
              className={input}
              style={inputStyle}
            />
          </Field>

          <SubmitButton pendingText="Saving…" className="min-h-11">
            Save settings
          </SubmitButton>
        </ActionForm>
      </Card>

      {/* ── allowlist ──────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Who can sign in"
          hint="Only these Google accounts can access the app. Enforced in the database, so an unlisted account that signs in successfully still sees nothing."
        />
        <ActionForm
          action={addAllowedEmail}
          resetOnSuccess
          className="flex flex-col gap-2 p-4 sm:flex-row sm:p-5"
        >
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder="someone@example.com"
            required
            autoComplete="off"
            className="min-h-11 w-full flex-1 rounded-xl border bg-[var(--surface)] px-3 text-sm focus:outline-2 focus:outline-offset-1"
            style={inputStyle}
          />
          <SubmitButton pendingText="Adding…" className="min-h-11">
            Allow
          </SubmitButton>
        </ActionForm>

        <ul className="rows border-t" style={{ borderColor: "var(--hairline)" }}>
          {emails.map((entry) => {
            const isMe = me?.toLowerCase() === entry.email.toLowerCase();
            return (
              <li key={entry.email} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="flex-1 text-sm">
                  {entry.email}
                  {isMe && (
                    <span className="ml-2">
                      <Pill>you</Pill>
                    </span>
                  )}
                </span>
                <ActionForm
                  action={removeAllowedEmail}
                  confirm={
                    isMe
                      ? "This is YOUR email. Removing it will lock you out of the app. Continue?"
                      : `Revoke access for ${entry.email}?`
                  }
                >
                  <input type="hidden" name="email" value={entry.email} />
                  <SubmitButton variant="danger" pendingText="Removing…" className="min-h-11">
                    Revoke
                  </SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>

        {emails.length === 1 && (
          <p
            className="border-t px-4 py-3 text-xs sm:px-5"
            style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
          >
            This is the only allowed account. The database refuses to delete the last one, so you
            cannot lock yourself out entirely.
          </p>
        )}
      </Card>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        {hint}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
