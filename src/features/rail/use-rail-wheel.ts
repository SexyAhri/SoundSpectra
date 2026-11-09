import { useEffect, useRef, useState } from "react";
import type { RailGroup } from "./model";

const selectionKey = (groupId: string) =>
  `soundspectra.rail.selection.${groupId}`;
function initialChoice(
  group: RailGroup,
  selected: string | null | undefined,
  remember: boolean,
) {
  if (group.items.some((item) => item.id === selected)) return selected!;
  if (remember) {
    try {
      const saved = localStorage.getItem(selectionKey(group.id));
      if (group.items.some((item) => item.id === saved)) return saved;
    } catch {
      /* Keep rotation available when local storage is unavailable. */
    }
  }
  return group.items[0]?.id ?? null;
}
export function useRailWheel(
  group: RailGroup,
  selected?: string | null,
  remember = true,
) {
  const [choice, choose] = useState<string | null>(() =>
    initialChoice(group, selected, remember),
  );
  const previous = useRef({
    group: group.id,
    ids: group.items.map((item) => item.id),
    selected,
  });
  const activeId =
    previous.current.group !== group.id
      ? initialChoice(group, selected, remember)
      : group.items.some((item) => item.id === choice)
        ? choice
        : (group.items.find((item) => item.id === selected)?.id ??
          group.items[
            Math.max(
              0,
              Math.min(
                group.items.length - 1,
                previous.current.ids.indexOf(choice ?? selected ?? ""),
              ),
            )
          ]?.id ??
          null);
  const active = Math.max(
    0,
    group.items.findIndex((item) => item.id === activeId),
  );
  useEffect(() => {
    const old = previous.current;
    const added = group.items.find((item) => !old.ids.includes(item.id));
    previous.current = {
      group: group.id,
      ids: group.items.map((item) => item.id),
      selected,
    };
    if (old.group !== group.id) {
      choose(activeId);
    } else if (
      selected !== old.selected &&
      group.items.some((item) => item.id === selected)
    ) {
      choose(selected!);
    } else if (added) choose(added.id);
    else if (choice !== null && !group.items.some((item) => item.id === choice))
      choose(activeId);
  }, [group.id, group.items, selected]);
  useEffect(() => {
    if (!remember) return;
    try {
      if (activeId) localStorage.setItem(selectionKey(group.id), activeId);
      else localStorage.removeItem(selectionKey(group.id));
    } catch {
      /* Selection is still usable for this session. */
    }
  }, [group.id, activeId, remember]);
  return { activeId, active, choose };
}
