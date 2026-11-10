import { useCallback, useState, type SetStateAction } from "react";

export function useUiPreference<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return valid(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const change = useCallback(
    (next: SetStateAction<T>) =>
      setValue((old) => {
        const result =
          typeof next === "function" ? (next as (old: T) => T)(old) : next;
        try {
          localStorage.setItem(key, JSON.stringify(result));
        } catch {
          /* Optional UI memory. */
        }
        return result;
      }),
    [key],
  );
  return [value, change] as const;
}
