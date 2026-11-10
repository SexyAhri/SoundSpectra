import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentProps,
} from "react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/utils";
import "./drawer.css";

const DrawerContext = createContext<{
  container: HTMLDivElement | null;
  scope: string;
} | null>(null);

/** Portals stay owned by the current settings page. */
export function DrawerHost({
  scope,
  children,
  ...props
}: ComponentProps<"div"> & { scope: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <DrawerContext.Provider value={{ container, scope }}>
      <div {...props} ref={setContainer}>
        {children}
      </div>
    </DrawerContext.Provider>
  );
}

export function useDrawerScope() {
  return useContext(DrawerContext)?.scope;
}

/** A nonblocking panel bounded by the visible part of its settings page. */
export function DrawerContent({
  className,
  style,
  onInteractOutside,
  ...props
}: ComponentProps<typeof Dialog.Content>) {
  const host = useContext(DrawerContext)?.container;
  const [bounds, setBounds] = useState<{
    top: number;
    right: number;
    bottom: number;
    maxWidth: number;
    width: number;
  }>();
  useLayoutEffect(() => {
    if (!host) return;
    const inspector = host.querySelector<HTMLElement>(
      ".workspace-inspector-container",
    );
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const inspectorWidth = inspector?.getBoundingClientRect().width ?? 380;
      const next = {
        top: Math.max(12, rect.top + 12),
        right: Math.max(12, innerWidth - rect.right + 12),
        bottom: Math.max(12, innerHeight - rect.bottom + 12),
        maxWidth: Math.max(
          0,
          Math.min(rect.right, innerWidth) - Math.max(rect.left, 0) - 24,
        ),
        width: Math.max(240, inspectorWidth - 24),
      };
      setBounds((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof typeof next] ===
            next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (inspector) observer.observe(inspector);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [host]);
  return (
    <Dialog.Portal container={host ?? undefined}>
      <Dialog.Content
        {...props}
        className={cn("drawer-content", className)}
        style={{ ...bounds, ...style }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          event.preventDefault();
        }}
      />
    </Dialog.Portal>
  );
}
