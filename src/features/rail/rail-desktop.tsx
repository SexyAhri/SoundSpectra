import { RailSurface } from "./rail-surface";
import { useRail } from "./use-rail";
import { useRailPaste } from "./use-rail-paste";
import { useRailDrop } from "./use-rail-drop";
import { invoke } from "@tauri-apps/api/core";
export function RailDesktop() {
  const controller = useRail(),
    groupId = new URLSearchParams(location.search).get("group");
  const group = controller.settings.groups.find((g) => g.id === groupId);
  const popupHost = new URLSearchParams(location.search).get("window") === "rail-popup";
  useRailPaste(controller, groupId, controller.settings.enabled);
  const dropError = useRailDrop(controller, groupId, controller.settings.enabled);
  return (
    <main className="rail-desktop" aria-label="桌面拾光绳">
      {controller.loaded && controller.settings.enabled && group ? (
        <RailSurface desktop popupWindow={popupHost ? "host" : "source"} group={group} controller={controller}
          onSelect={popupHost ? (_, itemId) => { if (itemId) void invoke("rail_popup_select", { itemId }).catch(() => {}) } : undefined} />
      ) : controller.error ? (
        <p role="alert">{controller.error}</p>
      ) : null}
      {controller.settings.enabled &&
        (controller.error || controller.desktopError || dropError) &&
        group && (
          <p className="rail-desktop-error" role="alert">
            {controller.error || controller.desktopError || dropError}
          </p>
        )}
    </main>
  );
}
