"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem("noisette-theme");
    const initial = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("noisette-theme", theme);
  }, [theme]);

  // Render nothing until the stored theme is known, so the icon never flips on hydrate.
  if (!theme) return <span className="iconbtn" aria-hidden="true" />;

  return (
    <button
      type="button"
      className="iconbtn"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
