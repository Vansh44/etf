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
        <CardHeader title="Strategy" hint="How much to spend and how concentrated to allow." />
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
            label="Concentration cap (%)"
            hint="Skip any ETF already above this share of portfolio value. Set to 100 to disable."
          >
            <input
              name="max_weight_pct"
              type="number"
              min="1"
              max="100"
              step="1"
              defaultValue={settings.maxWeightPct}
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
