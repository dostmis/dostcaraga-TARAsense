"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "tara-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function resolveInitialTheme(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return "light";
}

function subscribeToThemeChanges(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("tara-theme-change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("tara-theme-change", onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  return resolveInitialTheme();
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function setStoredTheme(theme: Theme) {
  applyTheme(theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event("tara-theme-change"));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToThemeChanges, getThemeSnapshot, getServerThemeSnapshot);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setStoredTheme(isDark ? "light" : "dark")}
      className="fixed bottom-4 right-4 z-[1200] inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition hover:scale-105 hover:border-[#f97316]"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      suppressHydrationWarning
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
