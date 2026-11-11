import { useCallback, useEffect, useState } from "react";
import { fadeUpdate } from "@/components/ui/fade-update";
import {
  Disc3,
  Image,
  Monitor,
  Type,
  GalleryHorizontalEnd,
  Music2,
} from "lucide-react";

export type WorkspacePanel =
  | "scene"
  | "lyrics"
  | "card"
  | "wallpaper"
  | "rail"
  | "music";
const panels = [
  { id: "scene", label: "灯效", icon: Monitor },
  { id: "lyrics", label: "歌词", icon: Type },
  { id: "card", label: "音乐卡片", icon: Disc3 },
  { id: "rail", label: "拾光绳", icon: GalleryHorizontalEnd },
  { id: "wallpaper", label: "壁纸", icon: Image },
  { id: "music", label: "音乐库", icon: Music2 },
] as const;

function readLocation() {
  const [target, tab] = location.hash.slice(1).split("/");
  return {
    home: !panels.some((item) => item.id === target),
    panel: panels.some((item) => item.id === target)
      ? (target as WorkspacePanel)
      : ("scene" as WorkspacePanel),
    tab: ["effect", "appearance", "position"].includes(tab) ? tab : "effect",
  };
}

export function useWorkspaceNavigation() {
  const [view, setView] = useState(readLocation);
  useEffect(() => {
    const change = () => setView(readLocation());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const navigate = useCallback(
    (panel: WorkspacePanel, tab = view.tab) => {
      const next = { panel, tab, home: false },
        hash = `#${panel}${panel === "scene" ? `/${tab}` : ""}`;
      if (location.hash !== hash)
        history[!view.home && panel === view.panel ? "replaceState" : "pushState"](null, "", hash);
      fadeUpdate(
        view.home || panel === "music" || view.panel === "music"
          ? ".workspace-body"
          : ".workspace-inspector-container",
        () => {
          setView(next);
        },
        "workspace-navigation",
      );
    },
    [view.home, view.panel, view.tab],
  );
  const selectPanel = useCallback(
    (panel: WorkspacePanel) => navigate(panel),
    [navigate],
  );
  const selectTab = useCallback(
    (tab: string) => navigate("scene", tab),
    [navigate],
  );
  const goHome = useCallback(() => {
    if (location.hash !== "#home") history.pushState(null, "", "#home");
    fadeUpdate(".workspace-body", () => {
      setView((current) => ({ ...current, panel: current.panel === "music" ? "scene" : current.panel, home: true }));
    }, "workspace-navigation");
  }, []);
  return {
    home: view.home,
    goHome,
    panel: view.panel,
    tab: view.tab,
    selectPanel,
    selectTab,
  };
}

export function WorkspaceNavigation({
  panel,
  onChange,
  mobile = false,
}: {
  panel: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
  mobile?: boolean;
}) {
  return (
    <nav
      className={mobile ? "workspace-mobile-nav" : "workspace-nav"}
      aria-label="编辑对象"
    >
      {panels.map((item) => (
        <button
          key={item.id}
          className={
            panel === item.id ? "nav-active nav-button" : "nav-item nav-button"
          }
          type="button"
          aria-label={item.label}
          aria-pressed={panel === item.id}
          onClick={() => onChange(item.id)}
        >
          <item.icon size={19} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
