"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/app/actions";
import { buttonClass } from "@/components/ui";

type Action = (formData: FormData) => Promise<ActionResult>;

/**
 * Wraps a Server Action so failures surface inline instead of vanishing.
 * Clears the form on success when `resetOnSuccess` is set, and folds away the
 * row it sits in when `collapseOnSuccess` is — an edit that saved is done.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  collapseOnSuccess = false,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  collapseOnSuccess?: boolean;
  confirm?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => {
      const result = await action(formData);
      if (result.ok && resetOnSuccess) formRef.current?.reset();
      if (result.ok && collapseOnSuccess) formRef.current?.closest("details")?.removeAttribute("open");
      return result;
    },
    null,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state && !state.ok && (
        <p role="alert" className="mt-2 text-sm font-medium text-loss">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Submit button that disables itself and shows pending text while in flight. */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className = "",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={`${buttonClass(variant, size)} ${className}`}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
