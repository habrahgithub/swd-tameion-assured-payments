"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

/** A small, persistent control that leaves system preference as the default. */
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem("tameion-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    }
  }, []);

  function changeTheme() {
    const selected = nextTheme[theme];
    setTheme(selected);
    if (selected === "system") {
      delete document.documentElement.dataset.theme;
      window.localStorage.removeItem("tameion-theme");
    } else {
      document.documentElement.dataset.theme = selected;
      window.localStorage.setItem("tameion-theme", selected);
    }
  }

  return (
    <button
      type="button"
      className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-start text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
      aria-label={`Color theme: ${theme}`}
      onClick={changeTheme}
    >
      Theme · {theme[0].toUpperCase()}{theme.slice(1)}
    </button>
  );
}
