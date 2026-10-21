import Link from "next/link";
import { BlockIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

export default async function NotAllowedPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-md rounded-3xl border border-hairline bg-surface p-7 shadow-card sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-loss-soft text-loss">
          <BlockIcon className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">Not on the allowlist</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          {email ? (
            <>
              <span className="font-medium text-ink">{email}</span> signed in with Google, but that address isn&apos;t
              allowed to use this app. You&apos;ve been signed out again.
            </>
          ) : (
            <>That Google account isn&apos;t allowed to use this app. You&apos;ve been signed out again.</>
          )}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          To grant access, sign in with an allowed address and add this one under Settings.
        </p>
        <Link href="/login" className={`${buttonClass("primary")} mt-7 w-full`}>
          Try a different account
        </Link>
      </div>
    </main>
  );
}
