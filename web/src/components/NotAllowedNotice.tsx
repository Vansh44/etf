/**
 * Shown when a signed-in user isn't on the allowlist.
 *
 * Belt-and-braces: RLS already returns zero rows for these users, so without
 * this they'd see a confusingly empty app rather than a clear refusal.
 */
export function NotAllowedNotice() {
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/40">
        <h1 className="font-semibold">Your account is not on the allowlist</h1>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          You are signed in, but this email has not been granted access. Ask an existing user to
          add it under Settings.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
