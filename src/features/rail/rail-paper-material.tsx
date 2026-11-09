/** One visible resource owner avoids relaying out gradients as wheel slots enter. */
export function RailPaperMaterial({ id }: { id: string }) {
  return <svg className="rail-paper-material" width="0" height="0" aria-hidden="true">
    <defs>
      <pattern id={`${id}-fibers`} width="43" height="47" patternUnits="userSpaceOnUse">
        <path d="m3 7 2 3m12 11 3-1m16 16-1 3M8 40l2-2M31 9l3 1M23 44l2 1" stroke="#806d4b" strokeOpacity=".16" strokeWidth=".45" />
        <path d="m5 14 5 1m12 17 6-1m11-16 3-1M14 3l3 1" stroke="#fffdf0" strokeOpacity=".65" strokeWidth=".6" />
        <circle cx="13" cy="27" r=".45" fill="#9a8358" opacity=".2" />
        <circle cx="36" cy="43" r=".6" fill="#9a8358" opacity=".15" />
      </pattern>
      <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2=".8" y2="1">
        <stop stopColor="#b9bd81" /><stop offset=".45" stopColor="var(--rail-print-ink)" /><stop offset=".5" stopColor="#b0b27b" /><stop offset="1" stopColor="#536244" />
      </linearGradient>
      <radialGradient id={`${id}-petal`} cx=".3" cy=".2" r=".9">
        <stop stopColor="#deb2b3" /><stop offset=".5" stopColor="var(--rail-flower-ink, #b36e83)" /><stop offset="1" stopColor="var(--rail-flower-edge, #865467)" />
      </radialGradient>
      <linearGradient id={`${id}-daisy`} x1="0" y1="0" x2=".6" y2="1">
        <stop stopColor="#f0d77e" /><stop offset=".5" stopColor="var(--rail-dried-flower, #d3b55e)" /><stop offset="1" stopColor="#a17d39" />
      </linearGradient>
      <linearGradient id={`${id}-wood`} x1="0" x2="1">
        <stop stopColor="#f8eac6" /><stop offset=".2" stopColor="#e8d3aa" /><stop offset=".55" stopColor="var(--rail-pin-color, #cfb083)" /><stop offset="1" stopColor="#a28759" />
      </linearGradient>
    </defs>
  </svg>;
}
