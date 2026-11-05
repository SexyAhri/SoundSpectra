export function placeRailPopup(hostWidth: number, anchor: { x: number; bottom: number }, desiredWidth: number) {
  const width = Math.max(1, Math.min(desiredWidth, hostWidth - 16))
  return { width, left: Math.max(8, Math.min(hostWidth - width - 8, anchor.x - width / 2)), top: Math.max(28, anchor.bottom + 12) }
}
