import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export const themeStorageKey = "soundspectra.theme";
const listeners = new Set<() => void>();
const system = window.matchMedia("(prefers-color-scheme: dark)");
const valid = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";
function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return valid(value) ? value : "dark";
  } catch {
    return "dark";
  }
}
let preference = readPreference();

function apply() {
  const theme =
    preference === "system" ? (system.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}
function publish() {
  apply();
  listeners.forEach((listener) => listener());
}

// Initialize before React paints, including transparent desktop webviews.
apply();
const onSystemChange = () => {
  if (preference === "system") apply();
};
const onStorageChange = (event: StorageEvent) => {
  if (event.key !== themeStorageKey && event.key !== null) return;
  preference = readPreference();
  publish();
};
system.addEventListener("change", onSystemChange);
window.addEventListener("storage", onStorageChange);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    system.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorageChange);
  });

export function setThemePreference(value: ThemePreference) {
  preference = value;
  try {
    localStorage.setItem(themeStorageKey, value);
  } catch {
    /* Keep the selection for this session. */
  }
  publish();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useThemePreference() {
  return useSyncExternalStore(subscribe, () => preference);
}
