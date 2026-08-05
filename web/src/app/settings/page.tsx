import { getAllowedEmails, getSettings } from "@/lib/data";
import { getSessionEmail, isAllowed } from "@/lib/supabase/server";
import { addAllowedEmail, removeAllowedEmail, updateSettings } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NotAllowedNotice } from "@/components/NotAllowedNotice";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAllowed())) return <NotAllowedNotice />;

  const [settings, emails, me] = await Promise.all([
    getSettings(),
    getAllowedEmails(),
    getSessionEmail(),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* ── strategy settings ──────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold">Strategy</h2>
        <ActionForm action={updateSettings} className="mt-4 space-y-4">
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
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
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
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
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
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </Field>

          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </ActionForm>
      </section>

      {/* ── allowlist ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold">Who can sign in</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Only these Google accounts can access the app. Enforced in the database, so an
          unlisted account that signs in successfully still sees nothing.
        </p>

        <ActionForm
          action={addAllowedEmail}
          resetOnSuccess
          className="mt-3 flex flex-col gap-2 sm:flex-row"
        >
          <input
            name="email"
            type="email"
            placeholder="someone@example.com"
            required
            autoComplete="off"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <SubmitButton pendingText="Adding…">Allow</SubmitButton>
        </ActionForm>

        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {emails.map((entry) => {
            const isMe = me?.toLowerCase() === entry.email.toLowerCase();
            return (
              <li key={entry.email} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-sm">
                  {entry.email}
                  {isMe && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      you
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
                  <SubmitButton variant="danger" pendingText="Removing…">
                    Revoke
                  </SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>

        {emails.length === 1 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            This is the only allowed account. The database refuses to delete the last one, so you
            cannot lock yourself out entirely.
          </p>
        )}
      </section>
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
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
