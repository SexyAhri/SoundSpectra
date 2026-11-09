import { useId } from "react";

/** Two timber jaws and the wire spring share the same upper-left light. */
export function RailWoodPin({ materialId }: { materialId?: string }) {
  const localId = useId();
  const id = materialId ? `${materialId}-wood` : localId;
  return (
    <svg
      className="rail-pin-art"
      width="12"
      height="34"
      viewBox="0 0 12 34"
      fill="none"
      aria-hidden="true"
    >
      {!materialId && (
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop stopColor="#f8eac6" />
            <stop offset=".2" stopColor="#e8d3aa" />
            <stop offset=".55" stopColor="var(--rail-pin-color, #cfb083)" />
            <stop offset="1" stopColor="#a28759" />
          </linearGradient>
        </defs>
      )}
      <path d="m3 1 7 1 1 30-6 1Z" fill="#79623d" />
      <path
        d="M1 .5 9 0 8.5 15 9 32 2 33 1.5 17Z"
        fill={`url(#${id})`}
        stroke="#8b724c"
        strokeWidth=".45"
      />
      <path
        d="M2.2 1.5 3 15 2.8 31M4 2 4.7 12M5.5 21 6 30M7 2 7.3 11"
        stroke="#967543"
        strokeOpacity=".32"
        strokeWidth=".45"
      />
      <path
        d="m1.7 1.5.5 12M2.4 20l.3 11"
        stroke="#fff7db"
        strokeOpacity=".85"
        strokeWidth=".7"
      />
      <path d="M1.4 15.5Q5 17 9.4 15.6L9.4 18Q5 19.4 1.4 18Z" fill="#645b48" />
      <path
        d="M1.3 15.4Q5 16.8 9.3 15.5M1.4 17.7Q5 19 9.4 17.7"
        stroke="#d5cfb9"
        strokeWidth=".65"
      />
      <path
        d="M9.5 16Q12 15.2 11.2 18.6L9.2 21"
        stroke="#6a624e"
        strokeWidth=".8"
      />
    </svg>
  );
}
