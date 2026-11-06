import { useEffect, useRef } from "react";
import type { RailController } from "./use-rail";

export function useRailPaste(
  controller: RailController,
  selected: string | null,
  active: boolean,
) {
  const current = useRef({ controller, selected, active });
  current.current = { controller, selected, active };
  useEffect(() => {
    const paste = (event: KeyboardEvent) => {
      const { controller, selected, active } = current.current;
      if (
        !active ||
        !controller.loaded ||
        !controller.supported ||
        controller.pending ||
        event.defaultPrevented ||
        event.repeat
      )
        return;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "v"
      )
        return;
      if (
        event
          .composedPath()
          .some(
            (target) =>
              target instanceof HTMLElement &&
              (target.matches("input, textarea, select") ||
                target.isContentEditable ||
                target.getAttribute("role") === "textbox"),
          )
      )
        return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return;
      const group =
        controller.settings.groups.find((group) => group.id === selected) ??
        controller.settings.groups[0];
      if (!group) return;
      event.preventDefault();
      void controller.pasteImage(group.id).catch(() => {});
    };
    document.addEventListener("keydown", paste);
    return () => document.removeEventListener("keydown", paste);
  }, []);
}
