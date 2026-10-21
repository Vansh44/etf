import { Page } from "@/components/AppShell";
import { AlertIcon } from "@/components/icons";
import { Card, buttonClass } from "@/components/ui";

/**
 * Shown when a signed-in user isn't on the allowlist.
 *
 * Belt-and-braces: RLS already returns zero rows for these users, so without
 * this they'd see a confusingly empty app rather than a clear refusal.
 */
export function NotAllowedNotice() {
  return (
    <Page width="narrow">
      <Card>
        <div className="p-6 sm:p-8">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-warn-soft text-warn">
            <AlertIcon />
          </span>
          <h1 className="mt-4 text-lg font-semibold">Your account isn&apos;t on the allowlist</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
            You&apos;re signed in, but this email hasn&apos;t been granted access. Ask an existing user to add it
            under Settings.
          </p>
          <form action="/auth/signout" method="post" className="mt-6">
            <button type="submit" className={buttonClass("secondary")}>
              Sign out
            </button>
          </form>
        </div>
      </Card>
    </Page>
  );
}
