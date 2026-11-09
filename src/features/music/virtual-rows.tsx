import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";

/** Uses the existing scroll surface, so browsing has only one scrollbar. */
export function VirtualRows({
  count,
  height,
  row,
}: {
  count: number;
  height: number;
  row: (index: number) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState([0, 40]);
  useLayoutEffect(() => {
    const node = root.current;
    const host = node?.closest<HTMLElement>(
      ".library-scroll, .library-queue-list",
    );
    if (!node || !host || count <= 200) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const offset =
          node.getBoundingClientRect().top -
          host.getBoundingClientRect().top +
          host.scrollTop;
        const start = Math.max(
          0,
          Math.floor((host.scrollTop - offset) / height) - 8,
        );
        const end = Math.min(
          count,
          start + Math.ceil(host.clientHeight / height) + 16,
        );
        setRange((old) =>
          old[0] === start && old[1] === end ? old : [start, end],
        );
      });
    };
    host.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [count, height]);
  const start = count > 200 ? Math.min(range[0], Math.max(0, count - 1)) : 0;
  const end =
    count > 200 ? Math.min(count, Math.max(start + 1, range[1])) : count;
  const navigate = (event: KeyboardEvent) => {
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      event.target instanceof HTMLInputElement
    )
      return;
    const host = root.current?.closest<HTMLElement>(
      ".library-scroll, .library-queue-list",
    );
    if (!host || !root.current) return;
    const current = Number(
      (event.target as HTMLElement).closest<HTMLElement>("[data-row-index]")
        ?.dataset.rowIndex ?? start,
    );
    const next = Math.max(
      0,
      Math.min(
        count - 1,
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : current + (event.key === "ArrowDown" ? 1 : -1),
      ),
    );
    event.preventDefault();
    const offset =
      root.current.getBoundingClientRect().top -
      host.getBoundingClientRect().top +
      host.scrollTop;
    host.scrollTop = offset + next * height;
    setRange([Math.max(0, next - 8), Math.min(count, next + 32)]);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`[data-row-index="${next}"] button`)
        ?.focus({ preventScroll: true }),
    );
  };
  return (
    <div ref={root} onKeyDown={navigate}>
      <div style={{ height: start * height }} aria-hidden="true" />
      {Array.from({ length: end - start }, (_, n) => (
        <div key={start + n} data-row-index={start + n} style={{ height }}>
          {row(start + n)}
        </div>
      ))}
      <div style={{ height: (count - end) * height }} aria-hidden="true" />
    </div>
  );
}
