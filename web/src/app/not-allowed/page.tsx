import Link from "next/link";

export default async function NotAllowedPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Not on the allowlist
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          {email ? (
            <>
              <span className="font-medium text-slate-900 dark:text-slate-200">{email}</span>{" "}
              signed in with Google successfully, but that address is not allowed to use this
              app. You have been signed out again.
            </>
          ) : (
            <>
              That Google account is not allowed to use this app. You have been signed out
              again.
            </>
          )}
        </p>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          To grant access, sign in with an allowed address and add this email under Settings.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Try a different account
        </Link>
      </div>
    </main>
  );
}
