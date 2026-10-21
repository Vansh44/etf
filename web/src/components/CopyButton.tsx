"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

/**
 * Copies the order to the clipboard, so switching to Groww to place it means
 * pasting rather than retyping a symbol, a quantity and a price.
 */
export function CopyButton({ text, label = "Copy order" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard access can be refused (non-HTTPS, permissions). Nothing
          // to recover — the order is on screen to copy by hand.
        }
      }}
      className={`${buttonClass("secondary")} w-full sm:w-auto`}
    >
      {copied ? <CheckIcon className="h-4 w-4 text-gain" /> : <CopyIcon className="h-4 w-4" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
