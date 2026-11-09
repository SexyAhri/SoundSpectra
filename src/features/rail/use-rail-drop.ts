import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { native } from "../spectrum/bridge";
import type { RailController } from "./use-rail";
import { isRailDraggingOut } from "./client";
export function useRailDrop(
  controller: RailController,
  selected: string | null,
  active: boolean,
) {
  const [dropError, setDropError] = useState<string | null>(null);
  const current = useRef({ controller, selected, active });
  current.current = { controller, selected, active };
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    // Let WebView2 deliver OS file objects through its own renderer window.
    // Registering OLE on the outer Tauri HWND cannot override a target owned
    // by the browser/GPU process. JS never guesses paths from file names.
    const fileDrag = (event: DragEvent) =>
      !!event.dataTransfer &&
      Array.from(event.dataTransfer.types).includes("Files");
    const dragover = (event: DragEvent) => {
      if (!fileDrag(event)) return;
      // Prevent file navigation even when the rail panel is inactive.
      event.preventDefault();
      const transfer = event.dataTransfer!;
      const allowed = current.current.active && !isRailDraggingOut();
      transfer.dropEffect = allowed
        ? transfer.effectAllowed === "link" ||
          transfer.effectAllowed === "linkMove"
          ? "link"
          : "copy"
        : "none";
    };
    const domDrop = (event: DragEvent) => {
      if (!fileDrag(event)) return;
      event.preventDefault();
      if (!current.current.active || isRailDraggingOut()) return;
      const files = Array.from(event.dataTransfer!.files);
      if (!files.length || files.length > 48) {
        setDropError("每次可拖入 1～48 个文件、文件夹或快捷方式");
        return;
      }
      const webview = (
        window as Window & {
          chrome?: {
            webview?: {
              postMessageWithAdditionalObjects?: (
                message: string,
                objects: File[],
              ) => void;
            };
          };
        }
      ).chrome?.webview;
      if (!webview?.postMessageWithAdditionalObjects) {
        setDropError("当前 WebView2 不支持文件拖入，请更新 WebView2 后重试");
        return;
      }
      setDropError(null);
      try {
        webview.postMessageWithAdditionalObjects(
          JSON.stringify({
            kind: "soundspectra:rail-file-drop",
            x: event.clientX * devicePixelRatio,
            y: event.clientY * devicePixelRatio,
          }),
          files,
        );
      } catch {
        setDropError("无法读取拖入的系统文件，请重新拖入");
      }
    };
    window.addEventListener("dragover", dragover, true);
    window.addEventListener("drop", domDrop, true);
    const dropped = ({
      position,
      paths,
    }: {
      position: { x: number; y: number };
      paths: string[];
    }) => {
      if (!current.current.active || isRailDraggingOut()) return;
      setDropError(null);
      const ratio = window.devicePixelRatio;
      const hovered = document
        .elementFromPoint(position.x / ratio, position.y / ratio)
        ?.closest<HTMLElement>("[data-rail-group]")?.dataset.railGroup;
      const group =
        hovered ??
        current.current.selected ??
        current.current.controller.settings.groups[0]?.id;
      if (group)
        void current.current.controller.add(group, paths).catch(() => {});
    };
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") dropped(event.payload);
      })
      .then(keep)
      .catch(() => {});
    void listen<{ position: { x: number; y: number }; paths: string[] }>(
      "rail-native-drop",
      (event) => dropped(event.payload),
    )
      .then(keep)
      .catch(() => {});
    void listen<string>("rail-drop-error", (event) => {
      if (current.current.active) setDropError(event.payload);
    })
      .then(keep)
      .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("dragover", dragover, true);
      window.removeEventListener("drop", domDrop, true);
      stops.forEach((stop) => stop());
    };
  }, []);
  return dropError;
}
