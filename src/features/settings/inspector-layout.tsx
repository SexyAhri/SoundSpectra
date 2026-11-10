import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useUiPreference } from "./use-ui-preference";
import { usePanelMemory } from "./use-panel-memory";

export function InspectorLayout({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string;
}) {
  const [width, setWidth] = useUiPreference(
    "soundspectra.inspector-width",
    380,
    (v): v is number => typeof v === "number" && v >= 300 && v <= 560,
  );
  const [collapsed, setCollapsed] = useUiPreference(
    "soundspectra.inspector-collapsed",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const [draft, setDraft] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; width: number } | null>(null);
  usePanelMemory(root, scope);
  const clamp = (value: number) =>
    Math.max(300, Math.min(560, window.innerWidth * 0.48, value));
  return (
    <div
      ref={root}
      className="workspace-inspector-container"
      data-collapsed={collapsed || undefined}
      style={{ "--inspector-width": `${draft ?? width}px` } as CSSProperties}
    >
      <div
        className="inspector-resizer"
        role="separator"
        aria-label="属性栏宽度"
        aria-orientation="vertical"
        tabIndex={collapsed ? -1 : 0}
        aria-valuemin={300}
        aria-valuemax={560}
        aria-valuenow={Math.round(draft ?? width)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          gesture.current = { x: e.clientX, width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (gesture.current)
            setDraft(
              clamp(gesture.current.width + gesture.current.x - e.clientX),
            );
        }}
        onPointerUp={(e) => {
          if (!gesture.current) return;
          setWidth(
            clamp(gesture.current.width + gesture.current.x - e.clientX),
          );
          gesture.current = null;
          setDraft(null);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
          setDraft(null);
        }}
        onDoubleClick={() => setWidth(380)}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            setWidth(
              clamp(
                e.key === "Home"
                  ? 300
                  : e.key === "End"
                    ? 560
                    : width + (e.key === "ArrowLeft" ? 20 : -20),
              ),
            );
          }
        }}
      />
      <div className="inspector-layout-toggle">
        <IconButton
          aria-label={collapsed ? "展开属性栏" : "收起属性栏"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelRightOpen size={16} />
          ) : (
            <PanelRightClose size={16} />
          )}
        </IconButton>
      </div>
      <div className="inspector-layout-content" hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
