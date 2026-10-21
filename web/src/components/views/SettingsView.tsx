import { addAllowedEmail, removeAllowedEmail, updateSettings } from "@/app/actions";
import type { AllowedEmail } from "@/lib/data";
import { CHEAPNESS_LOOKBACK, CHEAPNESS_WEIGHT, GAP_WEIGHT, type Settings } from "@/lib/strategy";
import type { ThemeChoice } from "@/lib/theme";
import { Page } from "@/components/AppShell";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ThemeSetting } from "@/components/ThemeToggle";
import { SignOutIcon } from "@/components/icons";
import { Card, CardHeader, Pill, buttonClass, inputClass } from "@/components/ui";

/**
 * The Settings screen, grouped the way a broker app groups them: how it
 * looks, how much to buy, which ETFs to refuse, when to refuse the data, and
 * who can sign in. One form spans the three strategy groups, with a save bar
 * that stays in reach of the thumb on a phone.
 */

export type SettingsData = {
  settings: Settings;
  emails: AllowedEmail[];
  me: string | null;
  theme: ThemeChoice;
};

const share = (weight: number) => `${(weight * 100).toFixed(0)}%`;

export function SettingsView({ settings, emails, me, theme }: SettingsData) {
  return (
    <Page width="narrow">
      <Card>
        <CardHeader title="Appearance" hint="Follow your phone's light or dark setting, or pick one." />
        <div className="p-4 sm:p-5">
          <ThemeSetting initial={theme} />
        </div>
      </Card>

      <Card>
        <CardHeader title="How the pick is scored" />
        <div className="grid grid-cols-2 divide-x divide-hairline">
          <div className="p-4 sm:p-5">
            <p className="figure text-2xl font-semibold text-accent">{share(CHEAPNESS_WEIGHT)}</p>
            <p className="mt-1 text-sm font-medium">Cheapness</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
              How far below its own {CHEAPNESS_LOOKBACK}-day average each ETF trades.
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="figure text-2xl font-semibold text-accent">{share(GAP_WEIGHT)}</p>
            <p className="mt-1 text-sm font-medium">Allocation</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
              How far below its target share of your portfolio it sits.
            </p>
          </div>
        </div>
        <p className="border-t border-hairline px-4 py-3 text-xs leading-relaxed text-ink-2 sm:px-5">
          Each is marked 0–100 against the other eligible ETFs; the highest total is the pick. The split is fixed
          in code — the settings below decide what gets bought and what gets refused.
        </p>
      </Card>

      <ActionForm action={updateSettings} className="space-y-3 sm:space-y-4">
        <Card>
          <CardHeader title="Buying" />
          <div className="rows">
            <NumberField
              name="budget"
              label="Budget per run"
              hint="How much to spend each time. Nothing tracks how often you run it."
              value={settings.budget}
              min="1"
              step="1"
              prefix="₹"
            />
            <NumberField
              name="limit_buffer_pct"
              label="Limit buffer"
              hint="The suggested limit price sits this far above the live price so the order fills."
              value={settings.limitBufferPct}
              min="0"
              max="5"
              step="0.05"
              suffix="%"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Premium checks" hint="Refuse ETFs trading above the value of what they hold." />
          <div className="rows">
            <NumberField
              name="max_premium_pct"
              label="Max premium over NAV"
              hint="Absolute backstop, whatever the ETF's own history says. International ETFs can run to +16% when funds hit the SEBI overseas cap."
              value={settings.maxPremiumPct}
              min="0"
              max="50"
              step="0.1"
              suffix="%"
            />
            <NumberField
              name="premium_floor_pct"
              label="Premium noise floor"
              hint="Premiums at or below this are never refused, however unusual they are for a tight-tracking ETF."
              value={settings.premiumFloorPct}
              min="0"
              max="5"
              step="0.05"
              suffix="%"
            />
            <NumberField
              name="max_premium_pctile"
              label="Max premium percentile"
              hint="Refuse when today's premium is above this percentile of the ETF's own trailing premiums. Dormant until it has 60 sessions of history."
              value={settings.maxPremiumPctile}
              min="50"
              max="100"
              step="1"
              suffix="pctile"
            />
            <NumberField
              name="max_nav_age_days"
              label="Max NAV age"
              hint="Ignore an end-of-day NAV older than this. International ETFs publish a day late."
              value={settings.maxNavAgeDays}
              min="1"
              max="30"
              step="1"
              suffix="days"
            />
            <NumberField
              name="max_inav_age_minutes"
              label="Max iNAV age"
              hint="Ignore an intraday iNAV struck longer ago than this and fall back to the end-of-day NAV."
              value={settings.maxInavAgeMinutes}
              min="5"
              max="1440"
              step="5"
              suffix="min"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Data checks" hint="Refuse to recommend on thin or stale prices." />
          <div className="rows">
            <NumberField
              name="min_candles"
              label="Minimum history"
              hint={`Daily closes an ETF needs before it is considered. Cheapness only looks back ${CHEAPNESS_LOOKBACK} sessions, so lower this to let newly listed ETFs in sooner.`}
              value={settings.minCandles}
              min="60"
              max="500"
              step="1"
              suffix="sessions"
            />
            <NumberField
              name="max_bar_age_sessions"
              label="Max price lag"
              hint="Refuse everything if the newest prices are this many NSE sessions behind. 1 gives slack for a missing holiday below; 0 once the list is trusted."
              value={settings.maxBarAgeSessions}
              min="0"
              max="5"
              step="1"
              suffix="sessions"
            />
            <div className="px-4 py-4 sm:px-5">
              <label htmlFor="nse_holidays" className="block text-sm font-medium">
                NSE holidays
              </label>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
                One date per line (yyyy-mm-dd), from the NSE holiday circular. A missing one reads as a skipped
                session and can block a run.
              </p>
              <textarea
                id="nse_holidays"
                name="nse_holidays"
                rows={4}
                defaultValue={settings.nseHolidays.join("\n")}
                placeholder="2026-01-26"
                className={`${inputClass} tnum mt-2.5 w-full py-2.5 sm:max-w-72`}
              />
            </div>
          </div>
        </Card>

        {/* Pinned above the tab bar on phones, so Save is always one tap away. */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 sm:bottom-4">
          <div className="rounded-2xl border border-hairline bg-surface/90 p-2 shadow-pop backdrop-blur-xl sm:inline-block">
            <SubmitButton pendingText="Saving…" className="w-full sm:w-auto sm:px-8">
              Save settings
            </SubmitButton>
          </div>
        </div>
      </ActionForm>

      <Card>
        <CardHeader
          title="Who can sign in"
          count={emails.length}
          hint="Only these Google accounts can use the app. Enforced in the database, so an unlisted account that signs in still sees nothing."
        />
        <ActionForm action={addAllowedEmail} resetOnSuccess className="flex flex-col gap-2 p-4 sm:flex-row sm:p-5">
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder="someone@example.com"
            required
            autoComplete="off"
            aria-label="Email to allow"
            className={`${inputClass} w-full flex-1`}
          />
          <SubmitButton pendingText="Adding…" className="sm:w-28">
            Allow
          </SubmitButton>
        </ActionForm>
        <ul className="rows border-t border-hairline">
          {emails.map((entry) => {
            const isMe = me?.toLowerCase() === entry.email.toLowerCase();
            return (
              <li key={entry.email} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase text-ink-2">
                  {entry.email.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="truncate">{entry.email}</span>
                  {isMe && <Pill tone="accent">You</Pill>}
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
                  <SubmitButton variant="danger" size="sm" pendingText="…">
                    Revoke
                  </SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>
        {emails.length === 1 && (
          <p className="border-t border-hairline px-4 py-3 text-xs text-ink-2 sm:px-5">
            This is the only allowed account. The database refuses to delete the last one, so you can&apos;t lock
            yourself out entirely.
          </p>
        )}
      </Card>

      {me && (
        <Card>
          <div className="flex items-center gap-3 p-4 sm:p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold uppercase text-accent">
              {me.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-2">Signed in as</p>
              <p className="truncate text-sm font-medium">{me}</p>
            </div>
            <form action="/auth/signout" method="post">
              <button type="submit" className={buttonClass("danger", "sm")}>
                <SignOutIcon className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </Card>
      )}
    </Page>
  );
}

/** One setting: label and explanation, with the field and its unit beside it. */
function NumberField({
  name,
  label,
  hint,
  value,
  min,
  max,
  step,
  prefix,
  suffix,
}: {
  name: string;
  label: string;
  hint: string;
  value: number;
  min?: string;
  max?: string;
  step?: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="gap-6 px-4 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:px-5">
      <div>
        <label htmlFor={name} className="block text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{hint}</p>
      </div>
      <div className="relative mt-2.5 sm:mt-0">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-2">{prefix}</span>
        )}
        <input
          id={name}
          name={name}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          defaultValue={value}
          required
          className={`${inputClass} tnum w-full ${prefix ? "pl-8" : ""} ${suffix ? "pr-20" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-2">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
