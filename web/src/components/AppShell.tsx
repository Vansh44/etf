import { Nav } from "@/components/Nav";

/**
 * The signed-in frame: header, bottom tab bar on phones, and content padded
 * so nothing hides under the bar (64px plus the iOS home-indicator inset).
 */
export function AppShell({
  email,
  base,
  children,
}: {
  email: string;
  base?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav email={email} base={base} />
      <div className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
    </>
  );
}

/** Page width and spacing, shared so every screen lines up with the header. */
export function Page({
  children,
  width = "wide",
}: {
  children: React.ReactNode;
  width?: "wide" | "narrow";
}) {
  return (
    <main
      className={`mx-auto space-y-3 px-3 py-3 sm:space-y-4 sm:px-6 sm:py-6 ${
        width === "wide" ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      {children}
    </main>
  );
}
