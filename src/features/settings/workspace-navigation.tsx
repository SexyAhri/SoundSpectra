import { useEffect, useState } from "react";
import {
  Disc3,
  Image,
  Monitor,
  Type,
  GalleryHorizontalEnd,
} from "lucide-react";

export type WorkspacePanel = "scene" | "lyrics" | "card" | "wallpaper" | "rail";
const panels = [
  { id: "rail", label: "拾光绳", icon: GalleryHorizontalEnd },
  { id: "scene", label: "灯效", icon: Monitor },
  { id: "lyrics", label: "歌词", icon: Type },
  { id: "card", label: "音乐卡片", icon: Disc3 },
  { id: "wallpaper", label: "壁纸", icon: Image },
] as const;

function readLocation() {
  const [target, tab] = location.hash.slice(1).split("/");
  return {
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
  const navigate = (panel: WorkspacePanel, tab = view.tab) => {
    const next = { panel, tab },
      hash = `#${panel}${panel === "scene" ? `/${tab}` : ""}`;
    if (location.hash !== hash)
      history[panel === view.panel ? "replaceState" : "pushState"](
        null,
        "",
        hash,
      );
    setView(next);
  };
  return {
    panel: view.panel,
    tab: view.tab,
    selectPanel: (panel: WorkspacePanel) => navigate(panel),
    selectTab: (tab: string) => navigate("scene", tab),
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
