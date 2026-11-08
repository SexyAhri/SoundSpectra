import type { ReactNode } from 'react'

/** Clip and card share the same pivot; content keeps its existing semantics. */
export function RailItemFrame({ children }: { children: ReactNode }) {
  return <div className="rail-sway">
    <span className="rail-clip" aria-hidden="true" />
    {children}
  </div>
}
