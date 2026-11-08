import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  GripHorizontal,
  Link2,
  Plus,
  X,
} from "lucide-react";
import { native } from "../spectrum/bridge";
import { dragRailItem, openRailItem } from "./client";
import { RailMedia } from "./rail-media";
import { RailItemPicker } from "./rail-item-picker";
import { kindLabels, railSkin, type RailGroup, type RailItem } from "./model";
import type { RailController } from "./use-rail";
import { NoteEditor, RailAddPanel } from "./rail-add-panel";
import { placeRailPopup } from "./popup-position";
import { useRailMotion } from "./use-rail-motion";
import { RailMotionSnapshot } from "./rail-motion-snapshot";
import { railFocusRequest } from "./focus";
import { useRailReorder } from "./use-rail-reorder";
import { FolderBrowser } from "./folder-browser";
import { railWheel } from "./rail-wheel";
import { useRailWheel } from "./use-rail-wheel";
import { useRailPresence } from "./use-rail-presence";
import {
  useRailPopupWindow,
  type RailPopup as Popup,
} from "./use-rail-popup-window";
import { useRailHitRegions } from "./use-rail-hit-regions";
import { RailCord } from "./rail-cord";
import { RailItemFrame } from './rail-item-frame';
import { getRailSkinTheme, railSkinStyle } from './skin-theme';
import { useRailSway } from './use-rail-sway';
import './rail-skins.css';

interface Props {
  group: RailGroup;
  controller: RailController;
  selected?: string | null;
  desktop?: boolean;
  popupWindow?: "source" | "host";
  onSelect?: (groupId: string, itemId?: string) => void;
  onDragGroup?: (
    event: PointerEvent<HTMLButtonElement>,
    group: RailGroup,
  ) => void;
  editing?: boolean;
  layoutWidth?: number;
}
export function RailSurface({
  group,
  controller,
  selected,
  desktop = false,
  popupWindow,
  onSelect,
  onDragGroup,
  editing = false,
  layoutWidth,
}: Props) {
  const holder = useRef<HTMLDivElement>(null),
    [measuredWidth, setWidth] = useState(780);
  const width = layoutWidth ?? measuredWidth;
  const theme = getRailSkinTheme(group.skin);
  const [requestedPopup, setPopup] = useState<Popup | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const popup = useRailPresence(requestedPopup);
  // A slow Shell/save reply belongs to the panel that started it. Closing or
  // replacing that panel must not let its completion dismiss a newer one.
  const completePopup = (expected = requestedPopup) => {
    setPopup((current) => (current === expected ? null : current));
  };
  const bodyPresent = useRailPresence(group.collapsed ? null : true, 180);
  const animateBodyEntry = useRef(group.collapsed);
  if (group.collapsed) animateBodyEntry.current = true;
  const [desktopSelection, setDesktopSelection] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  useEffect(() => {
    if (!native || !desktop) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen("rail-restored", () => {
      if (!disposed) setMediaRevision((value) => value + 1);
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
  }, [desktop]);
  useEffect(() => {
    if (requestedPopup?.token) {
      setRename(null);
      setNotice(null);
    }
  }, [requestedPopup?.token]);
  const [popupAnchor, setPopupAnchor] = useState({ x: 120, bottom: 80 });
  const popupElement = useRef<HTMLElement>(null);
  const [previewPopup, setPreviewPopup] = useState<CSSProperties>({});
  const cordClickTimer = useRef(0);
  const doubleClickInterval = useRef(500);
  useEffect(() => {
    if (native)
      void invoke<number>("rail_double_click_interval")
        .then((value) => {
          if (value > 0) doubleClickInterval.current = value;
        })
        .catch(() => {});
    const cancel = (event: Event) => {
      if (!(event.target as Element)?.closest?.(".rail-cord-add"))
        window.clearTimeout(cordClickTimer.current);
      // A blur event targets Window, which cannot be passed to Node.contains().
      if (
        !(event.target instanceof Node) ||
        !holder.current?.contains(event.target)
      )
        recentActivation.current = null;
    };
    document.addEventListener("pointerdown", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.clearTimeout(cordClickTimer.current);
      document.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  // Keep the approved proportions without shrinking narrow groups into miniature cards.
  const unit = Math.max(0.65, Math.min(1.35, width / 880));
  const itemWidth = (item: RailItem) =>
    item.kind === "app"
      ? Math.min(88, 72 * unit)
      : (item.kind === "image"
          ? 167
          : item.kind === "file" || item.kind === "folder"
            ? 104
            : 126) * unit;
  const wheel = useRailWheel(group, selected, popupWindow !== "host");
  const captureMotion = useRailMotion(
    holder,
    ".rail-items > .rail-hanging",
    "railItem",
    `${group.id}:${group.collapsed}:${unit}`,
  );
  const geometry = railWheel(
    width,
    Math.max(88 * unit, ...group.items.map(itemWidth)),
    unit,
    group.items.length,
    theme.physics.gravitySagFactor,
  );
  useRailSway(holder, theme, group.id, `${wheel.active}:${group.items.map(item => item.id).join(',')}`,
    !!bodyPresent && !group.collapsed && !editing && popupWindow !== 'host', geometry, unit, group.audioSync);
  const visible = group.items;
  const rotate = (direction: number) => {
    const index =
      (wheel.active + direction + group.items.length) % group.items.length;
    const item = group.items[index];
    if (item) {
      wheel.choose(item.id);
      onSelect?.(group.id, item.id);
    }
  };
  const wheelDelta = useRef(0);
  const recentActivation = useRef<{
    x: number;
    y: number;
    until: number;
  } | null>(null);
  const popupTrigger = useRef<HTMLElement | null>(null);
  const opening = useRef(new Set<string>());
  const closePopup = () => {
    const focus = railFocusRequest(),
      trigger = popupTrigger.current;
    setPopup(null);
    setRename(null);
    requestAnimationFrame(() => {
      focus.focus(trigger);
      focus.dispose();
    });
  };
  useLayoutEffect(() => {
    const panel = popupElement.current;
    if (desktop || !panel || !popup) return;
    const position = () => {
      const host = holder.current?.getBoundingClientRect();
      if (!host) return;
      const layout = placeRailPopup(
        host.width,
        popupAnchor,
        popup.mode === "menu" ? 280 : 440,
      );
      const maxHeight = Math.min(360, window.innerHeight - 24);
      setPreviewPopup({
        position: "fixed",
        width: layout.width,
        left: Math.max(
          8,
          Math.min(window.innerWidth - layout.width - 8, host.x + layout.left),
        ),
        top: Math.max(
          12,
          Math.min(window.innerHeight - maxHeight - 12, host.y + layout.top),
        ),
        maxHeight,
      });
    };
    // The browser's top layer escapes the clipped desktop preview while
    // retaining DOM ownership, keyboard handling and the existing material UI.
    position();
    panel.showPopover();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [desktop, popup?.mode, popupAnchor, width]);
  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    const scroll = (event: WheelEvent) => {
      if (
        (event.target as Element).closest(".rail-popup, input, textarea") ||
        group.collapsed ||
        group.items.length < 2 ||
        event.ctrlKey
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      wheelDelta.current +=
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (Math.abs(wheelDelta.current) >= 35) {
        rotate(wheelDelta.current > 0 ? 1 : -1);
        wheelDelta.current = 0;
      }
    };
    host.addEventListener("wheel", scroll, { passive: false });
    return () => host.removeEventListener("wheel", scroll);
  }, [group.items, group.collapsed, wheel.active, onSelect]);
  useLayoutEffect(() => {
    setWidth(holder.current!.clientWidth);
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(holder.current!);
    return () => observer.disconnect();
  }, []);
  useRailHitRegions(
    holder,
    desktop && native && popupWindow !== "host",
    group,
    geometry,
    wheel.active,
    unit,
    !!bodyPresent,
    popup?.mode,
    setNotice,
  );
  useEffect(() => {
    if (popupWindow === "source") return;
    const focus = railFocusRequest();
    let disposed = false,
      frame = 0;
    const ready =
      popupWindow === "host"
        ? requestedPopup?.token && popupElement.current
          ? invoke("rail_popup_resize", {
              token: requestedPopup.token,
              width: popupElement.current.offsetWidth,
              height: popupElement.current.offsetHeight,
            })
          : Promise.resolve()
        : desktop && native
          ? invoke("rail_popup", { open: !!popup })
          : Promise.resolve();
    void ready
      .then(() => {
        if (disposed || !requestedPopup) {
          focus.dispose();
          return;
        }
        frame = requestAnimationFrame(() => {
          focus.focus(
            holder.current?.querySelector<HTMLElement>(
              ".rail-popup textarea, .rail-popup input",
            ) ??
              holder.current?.querySelector<HTMLElement>(
                ".rail-popup button",
              ) ??
              null,
          );
          focus.dispose();
        });
      })
      .catch((error) => {
        if (!disposed) setNotice(String(error));
        focus.dispose();
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      focus.dispose();
    };
  }, [
    desktop,
    popupWindow,
    !!popup,
    requestedPopup?.token,
    requestedPopup?.mode,
    requestedPopup?.item?.id,
  ]);
  useEffect(() => {
    if (!requestedPopup) return;
    let disposed = false,
      stop: (() => void) | undefined;
    if (desktop && native)
      void listen<string | null>("rail-dismiss-popup", (event) => {
        setPopup((value) =>
          typeof event.payload === "string" && value?.token !== event.payload
            ? value
            : null,
        );
        setRename(null);
      })
        .then((value) => {
          if (disposed) value();
          else stop = value;
        })
        .catch(() => {});
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePopup();
      }
    };
    const outside = (event: Event) => {
      if (!popupElement.current?.contains(event.target as Node)) {
        setPopup(null);
        setRename(null);
      }
    };
    window.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [!!requestedPopup]);
  const perform = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      setNotice(null);
    } catch (error) {
      setNotice(String(error));
    }
  };
  const reorder = useRailReorder(
    controller.settings.groups,
    (change) => {
      void perform(() => controller.change(change));
    },
    controller.supported
      ? (id) =>
          perform(async () => {
            await dragRailItem(id);
          })
      : undefined,
    (id) => perform(() => controller.detach(id)),
  );
  const show = (mode: Popup["mode"], item?: RailItem) => {
    if (item) wheel.choose(item.id);
    if (!requestedPopup)
      popupTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    const host = holder.current?.getBoundingClientRect();
    const target = item
      ? [
          ...holder.current!.querySelectorAll<HTMLElement>("[data-rail-item]"),
        ].find((element) => element.dataset.railItem === item.id)
      : holder.current?.querySelector(".rail-cord-add");
    const bounds = target?.getBoundingClientRect();
    if (host && bounds)
      setPopupAnchor({
        x: item ? width / 2 : bounds.x - host.x + bounds.width / 2,
        bottom: item
          ? 28 + geometry.point(0).y + 154 * unit
          : bounds.bottom - host.y,
      });
    setRename(null);
    setPopup({
      mode,
      item: item ?? (mode === "more" ? group.items[wheel.active] : undefined),
      token:
        popupWindow === "host" ? requestedPopup?.token : crypto.randomUUID(),
      nativeWidth:
        popupWindow === "host" ? (mode === "menu" ? 280 : 440) : undefined,
    });
    setNotice(null);
  };
  const open = (item: RailItem) => {
    if (item.kind === "note") {
      if (desktop || !onSelect) show("note", item);
    } else if (controller.missing.includes(item.id)) {
      show("menu", item);
    } else {
      // Shell activation may be slow; repeated Enter/clicks share the pending launch.
      if (opening.current.has(item.id)) return;
      opening.current.add(item.id);
      void perform(async () => {
        try {
          await openRailItem(item.id);
          completePopup();
        } catch (error) {
          void controller.refresh();
          throw error;
        } finally {
          opening.current.delete(item.id);
        }
      });
    }
  };
  const openFromCord = (mode: "add" | "more") => {
    window.clearTimeout(cordClickTimer.current);
    show(mode);
    setPopupAnchor({
      x: width / 2,
      bottom: 28 + geometry.point(0).y + 100 * unit,
    });
  };
  const add = () => {
    onSelect?.(group.id);
    void show("add");
  };
  const card = (item: RailItem, index: number) => {
    const slot = geometry.slot(index, wheel.active);
    return (
      <div
        key={item.id}
        data-rail-item={item.id}
        data-reorder-side={
          reorder.target === item.id ? reorder.side : undefined
        }
        data-dragging={reorder.dragging === item.id || undefined}
        data-wheel-active={wheel.activeId === item.id ? "true" : undefined}
        inert={!slot.visible}
        aria-hidden={!slot.visible || undefined}
        className={`rail-hanging rail-${item.kind}${reorder.target === item.id ? " rail-reorder-target" : ""}`}
        style={
          {
            "--hang-drop": "0px",
            "--hang-tilt": "0deg",
            "--wheel-x": `${slot.x}px`,
            "--wheel-y": `${slot.y}px`,
            width: itemWidth(item),
            opacity: slot.visible ? 1 : 0,
            visibility: slot.visible ? "visible" : "hidden",
            "--wheel-angle": `${(slot.angle * 180) / Math.PI}deg`,
          } as CSSProperties
        }
      >
        <RailItemFrame>
          <button
            className="rail-item"
            type="button"
            aria-label={`${item.name}，${kindLabels[item.kind]}`}
            title={
              item.kind === "note"
                ? item.text
                : `${item.name}\n${item.path}\n单击或 Enter 打开，拖出拾光绳可发送到其他软件`
            }
            aria-pressed={(desktop ? desktopSelection : selected) === item.id}
            draggable={false}
            onClick={(event) => {
              if (event.detail > 0) {
                recentActivation.current = {
                  x: event.clientX,
                  y: event.clientY,
                  until: performance.now() + doubleClickInterval.current,
                };
              }
              setNotice(null);
              wheel.choose(item.id);
              setDesktopSelection(item.id);
              onSelect?.(group.id, item.id);
              open(item);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setDesktopSelection(item.id);
              wheel.choose(item.id);
              onSelect?.(group.id, item.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                open(item);
              }
              if (
                (event.shiftKey && event.key === "F10") ||
                event.key === "ContextMenu"
              ) {
                event.preventDefault();
              }
            }}
          >
            {item.kind === "note" ? (
              <>
                <span className="rail-note-kicker">随手记</span>
                <span className="rail-note-content">{item.text}</span>
              </>
            ) : (
              <>
                <span className="rail-item-media">
                  <RailMedia
                    item={item}
                    unavailable={controller.missing.includes(item.id)}
                    revision={mediaRevision}
                  />
                </span>
                {item.kind !== "image" && (
                  <span className="rail-item-name">{item.name}</span>
                )}
              </>
            )}
            {controller.missing.includes(item.id) && (
              <span className="rail-item-missing">
                <Link2 size={12} />
                需重新关联
              </span>
            )}
          </button>
          {item.kind === "folder" && (
            <button
              type="button"
              className="rail-folder-expand"
              aria-label={`展开${item.name}`}
              title="就地展开文件夹"
              onClick={() =>
                show(
                  controller.missing.includes(item.id) ? "menu" : "folder",
                  item,
                )
              }
            >
              <ChevronDown size={13} />
            </button>
          )}
          <button
            className="rail-item-menu"
            type="button"
            aria-label={`${item.name}的操作`}
            onClick={() => void show("menu", item)}
          >
            <Ellipsis size={13} />
          </button>
        </RailItemFrame>
      </div>
    );
  };
  const popupItem =
    popup?.item && group.items.find((item) => item.id === popup.item!.id);
  const popupMissing = !!popupItem && controller.missing.includes(popupItem.id);
  const popupLayout =
    popupWindow === "host"
      ? { width: popup?.nativeWidth ?? 280, left: 12, top: 12 }
      : placeRailPopup(width, popupAnchor, popup?.mode === "menu" ? 280 : 440);
  useRailPopupWindow(
    popupWindow,
    group,
    requestedPopup,
    popup,
    setPopup,
    popupLayout,
    popupElement,
    (id) => {
      wheel.choose(id);
      setDesktopSelection(id);
      onSelect?.(group.id, id);
    },
    setNotice,
  );
  return (
    <div
      ref={holder}
      className={`rail-surface rail-wheel${popupWindow === "host" ? " rail-popup-host" : ""}${popup ? " rail-popup-open" : ""}${editing ? " rail-is-editing" : ""}${group.collapsed ? " rail-is-collapsed" : ""}`}
      data-rail-skin={railSkin(group.skin)}
      data-rail-clip-accent={theme.clipStyle.accent}
      data-rail-group={group.id}
      {...reorder.events}
      onClickCapture={(event) => {
        reorder.events.onClickCapture(event);
        if (event.defaultPrevented || event.detail === 0) return;
        const pending = recentActivation.current;
        // A repeated click at the old position of a moving card must not launch
        // another item or open an unrelated menu after the first activation.
        if (
          pending &&
          (event.detail > 1 || performance.now() < pending.until) &&
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <=
            5 &&
          !(event.target as Element).closest(".rail-popup")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        reorder.events.onKeyDown(event);
        if (
          (event.target as Element).closest(".rail-popup, input, textarea") ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? group.items.length - 1
              : (wheel.active +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  group.items.length) %
                group.items.length;
        const item = group.items[next];
        if (item) {
          wheel.choose(item.id);
          onSelect?.(group.id, item.id);
          requestAnimationFrame(() =>
            holder.current
              ?.querySelector<HTMLButtonElement>(
                `[data-rail-item="${CSS.escape(item.id)}"] .rail-item`,
              )
              ?.focus({ preventScroll: true }),
          );
        }
      }}
      style={
        {
          ...railSkinStyle(theme),
          "--rail-unit": `${unit}px`,
          "--rail-cord-center": `${geometry.point(0).y}px`,
          minHeight:
            popupWindow === "host"
              ? 0
              : group.collapsed
                ? 36
                : geometry.height + 28,
        } as CSSProperties
      }
    >
      <div className="rail-design">
        {popupWindow !== "host" && (
          <header className="rail-header">
            <button
              className="rail-drag"
              aria-label={`选择并移动${group.name}`}
              onClick={() => onSelect?.(group.id)}
              onPointerDown={(event) => onDragGroup?.(event, group)}
            >
              <GripHorizontal size={16} />
              <strong>{group.name}</strong>
              <span>{group.items.length.toString().padStart(2, "0")}</span>
            </button>
            <div className="rail-header-actions">
              <button
                aria-label={`向${group.name}添加项目`}
                title="添加项目"
                onClick={add}
              >
                <Plus size={15} />
              </button>
              <button
                aria-label={`${group.collapsed ? "展开" : "收起"}${group.name}`}
                title={group.collapsed ? "展开" : "收起"}
                onClick={() => {
                  setPopup(null);
                  void perform(() =>
                    controller.change({
                      type: "group",
                      id: group.id,
                      collapsed: !group.collapsed,
                    }),
                  );
                }}
              >
                {group.collapsed ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronUp size={15} />
                )}
              </button>
            </div>
          </header>
        )}
        {popupWindow !== "host" && bodyPresent && (
          <div
            className="rail-body"
            data-entry={animateBodyEntry.current || undefined}
            inert={group.collapsed}
          >
            <button
              className="rail-cord-add"
              type="button"
              aria-label="点击绳子添加挂件"
              title="单击添加挂件，双击查看全部挂件"
              onClick={(event) => {
                window.clearTimeout(cordClickTimer.current);
                if (event.detail === 0) openFromCord("add");
                else if (event.detail === 1)
                  cordClickTimer.current = window.setTimeout(
                    () => openFromCord("add"),
                    doubleClickInterval.current + 20,
                  );
              }}
              onDoubleClick={() => openFromCord("more")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.shiftKey) {
                  event.preventDefault();
                  openFromCord("more");
                }
              }}
            >
              <svg
                className="rail-cord"
                viewBox={`0 0 ${width} ${geometry.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <RailCord skin={railSkin(group.skin)}
                  unit={unit}
                  geometry={geometry}
                  attachments={group.items
                    .map((_, index) => geometry.slot(index, wheel.active))
                    .filter((slot) => slot.visible)
                    .map((slot) => slot.x)}
                />
                <path className="rail-cord-hit" data-rail-rope-path={geometry.path} d={geometry.path} />
              </svg>
            </button>
            <RailMotionSnapshot
              beforeUpdate={() =>
                captureMotion(group.items.map((item) => item.id))
              }
            >
              <div className="rail-items">
                {visible.map(card)}
                {!group.items.length && (
                  <button className="rail-empty" onClick={add}>
                    <Plus size={22} />
                    <span>挂上常用的软件、文件或照片</span>
                    <small>
                      {desktop
                        ? "点击选择，或把文件拖到这里"
                        : "从右侧添加，也可以直接拖入文件"}
                    </small>
                  </button>
                )}
              </div>
            </RailMotionSnapshot>
          </div>
        )}
        {notice && !popup && (
          <div className="rail-inline-notice" role="alert">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice(null)}>
              <X size={12} />
            </button>
          </div>
        )}
        {popup && popupWindow !== "source" && (
          <section
            ref={popupElement}
            data-state={requestedPopup ? "open" : "closed"}
            inert={!requestedPopup}
            popover={desktop ? undefined : "manual"}
            className={`rail-popup rail-popup-${popup.mode}`}
            data-detaching={
              (popup.mode === "more" && !!reorder.detaching) || undefined
            }
            style={
              {
                ...popupLayout,
                "--rail-popup-top": `${popupLayout.top}px`,
                ...(!desktop ? previewPopup : {}),
              } as CSSProperties
            }
            aria-label={
              popup.mode === "add"
                ? "添加挂件"
                : popup.mode === "more"
                  ? "更多挂件"
                  : (popupItem?.name ?? "挂件操作")
            }
          >
            <div className="rail-popup-heading">
              <strong>
                {popup.mode === "add"
                  ? "想挂点什么？"
                  : popup.mode === "more"
                    ? `${group.name} · 更多`
                    : (popupItem?.name ?? "项目已移除")}
              </strong>
              <button
                aria-label="关闭挂件面板"
                onClick={() => {
                  closePopup();
                }}
              >
                <X size={16} />
              </button>
            </div>
            {notice && (
              <p className="rail-popup-error" role="alert">
                {notice}
              </p>
            )}
            {popup.mode === "menu" && popupMissing && (
              <p className="rail-popup-error" role="status">
                目标已移动或删除。可以重新关联，也可以取消挂载。
              </p>
            )}
            {popup.mode === "add" && (
              <RailAddPanel
                group={group}
                controller={controller}
                onDone={() => completePopup(popup)}
              />
            )}
            {popup.mode === "note" && popupItem && (
              <NoteEditor
                key={popupItem.id}
                item={popupItem}
                onSave={async (text) => {
                  await controller.change({
                    type: "item",
                    id: popupItem.id,
                    text,
                  });
                  completePopup(popup);
                }}
              />
            )}
            {popup.mode === "folder" && popupItem && (
              <FolderBrowser key={popupItem.id} item={popupItem} />
            )}
            {popup.mode === "more" && (
              <>
                <RailItemPicker
                  key={popup.token}
                  items={group.items}
                  activeId={wheel.activeId}
                  missing={controller.missing}
                  dragging={reorder.dragging}
                  target={reorder.target}
                  side={reorder.side}
                  onChoose={(item) => {
                    wheel.choose(item.id);
                    setDesktopSelection(item.id);
                    onSelect?.(group.id, item.id);
                    setPopup(null);
                  }}
                />
                <p className="rail-overflow-hint" role="status">
                  {reorder.detaching
                    ? "松开恢复到桌面"
                    : reorder.dragging
                      ? "松开放到标记位置"
                      : group.items.length
                        ? "拖动排序 · 拖入挂载 · 拖出恢复桌面"
                        : "把桌面图标拖到这里"}
                </p>
              </>
            )}
            {popup.mode === "menu" && popupItem && (
              <div className="rail-context-actions">
                {!popupMissing && (
                  <button onClick={() => open(popupItem)}>
                    {popupItem.kind === "note" ? "编辑便签" : "打开"}
                  </button>
                )}
                {!popupMissing && popupItem.kind === "folder" && (
                  <button onClick={() => show("folder", popupItem)}>
                    就地展开
                  </button>
                )}
                {popupItem.kind !== "note" && (
                  <>
                    {!popupMissing && (
                      <button
                        onClick={() =>
                          void perform(() => openRailItem(popupItem.id, true))
                        }
                      >
                        打开所在位置
                      </button>
                    )}
                    <button
                      onClick={() =>
                        void perform(() =>
                          navigator.clipboard.writeText(popupItem.path),
                        )
                      }
                    >
                      复制路径
                    </button>
                  </>
                )}
                <button onClick={() => setRename(popupItem.name)}>
                  修改显示名称
                </button>
                {popupItem.kind !== "note" && (
                  <button
                    onClick={() => {
                      void controller.pick(
                        group.id,
                        popupItem.kind === "folder",
                        popupItem.id,
                      );
                    }}
                  >
                    重新关联
                  </button>
                )}
                <button
                  onClick={() =>
                    void perform(async () => {
                      await controller.change({
                        type: "remove",
                        id: popupItem.id,
                      });
                      completePopup(popup);
                    })
                  }
                >
                  取消挂载
                </button>
                {rename !== null && (
                  <form
                    className="rail-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(async () => {
                        await controller.change({
                          type: "item",
                          id: popupItem.id,
                          name: rename,
                        });
                        setRename(null);
                      });
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="新的显示名称"
                      maxLength={120}
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                    />
                    <button type="submit">保存名称</button>
                  </form>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
