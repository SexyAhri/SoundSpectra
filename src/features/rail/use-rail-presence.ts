import { useEffect, useState } from 'react'

// Keep only the retiring presentation alive; saved changes take effect at once.
// A new value cancels retirement, including reopening during the exit transition.
export function useRailPresence<T>(value: T | null, duration = 160): T | null {
  const [retained, retain] = useState(value)
  useEffect(() => {
    if (value !== null) { retain(value); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { retain(null); return }
    const timer = window.setTimeout(() => retain(null), duration)
    return () => window.clearTimeout(timer)
  }, [value, duration])
  return value ?? retained
}
