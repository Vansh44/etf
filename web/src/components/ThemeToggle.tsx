"use client";

import { useState } from "react";
import { applyTheme, effectiveTheme, type ThemeChoice } from "@/lib/theme";
import { MoonIcon, SunIcon } from "@/components/icons";

/**
 * Header button: flips between light and dark. Which icon shows is decided by
 * CSS (.when-light / .when-dark), so server and client render the same markup.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => applyTheme(effectiveTheme() === "dark" ? "light" : "dark")}
      className={`grid h-10 w-10 place-items-center rounded-full text-ink-2 transition hover:bg-surface-2 active:scale-95 ${className}`}
      aria-label="Switch between light and dark theme"
    >
      <span className="when-light">
        <MoonIcon />
      </span>
      <span className="when-dark">
        <SunIcon />
      </span>
    </button>
  );
}

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "Phone" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings control: the full three-way choice, including "follow the phone". */
export function ThemeSetting({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === choice;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setChoice(option.value);
              applyTheme(option.value);
            }}
            className={`min-h-10 rounded-lg text-sm font-medium transition ${
              selected ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
