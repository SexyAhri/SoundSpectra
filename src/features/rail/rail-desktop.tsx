import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { RailSurface } from "./rail-surface";
import { useRail } from "./use-rail";
export function RailDesktop() {
  const controller = useRail(),
    groupId = new URLSearchParams(location.search).get("group");
  const group = controller.settings.groups.find((g) => g.id === groupId);
  useEffect(() => {
    if (!groupId) return;
    let disposed = false,
      stop: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop")
          void controller.add(groupId, event.payload.paths).catch(() => {});
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [groupId, controller.add]);
  return (
    <main className="rail-desktop" aria-label="桌面挂轨">
      {controller.loaded && group ? (
        <RailSurface desktop group={group} controller={controller} />
      ) : controller.error ? (
        <p role="alert">{controller.error}</p>
      ) : null}
      {controller.error && group && (
        <p className="rail-desktop-error" role="alert">
          {controller.error}
        </p>
      )}
    </main>
  );
}
