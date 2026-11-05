import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { openRailItem } from "./client";
import { RailMedia } from "./rail-media";
import { kindLabels, type RailGroup, type RailItem } from "./model";
import type { RailController } from "./use-rail";
import { NoteEditor, RailAddPanel } from './rail-add-panel';
import { placeRailPopup } from './popup-position';
import { useRailMotion } from './use-rail-motion';
import { railFocusRequest } from './focus';
import { useRailReorder } from './use-rail-reorder';

interface Props {
  group: RailGroup;
  controller: RailController;
  selected?: string | null;
  desktop?: boolean;
  onSelect?: (groupId: string, itemId?: string) => void;
  onDragGroup?: (
    event: PointerEvent<HTMLButtonElement>,
    group: RailGroup,
  ) => void;
  editing?: boolean;
}
type Popup = { mode: "menu" | "more" | "add" | "note"; item?: RailItem };
export function RailSurface({
  group,
  controller,
  selected,
  desktop = false,
  onSelect,
  onDragGroup,
  editing = false,
}: Props) {
  const holder = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(780);
  const [popup, setPopup] = useState<Popup | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [desktopSelection, setDesktopSelection] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [popupAnchor, setPopupAnchor] = useState({ x: 120, bottom: 80 });
  // Keep the approved proportions without shrinking narrow groups into miniature cards.
  const unit = Math.max(.65, Math.min(1.35, width / 880));
  useRailMotion(holder, '.rail-items > .rail-hanging', 'railItem', `${group.id}:${group.collapsed}:${unit}`);
  const itemWidth = (item: RailItem) => item.kind === 'app' ? Math.min(88, 72 * unit) : (item.kind === 'image' ? 167 : item.kind === 'file' ? 108 : 126) * unit;
  const fits = (reserve: number) => { let used = 0, count = 0; for (const item of group.items) { const size = itemWidth(item) + (count ? 26 * unit : 0); if (used + size > width - 32 * unit - reserve) break; used += size; count++ } return count };
  const allFit = fits(0), capacity = allFit < group.items.length ? fits(70) : allFit;
  const visible = group.items.slice(0, capacity);
  const popupTrigger = useRef<HTMLElement | null>(null);
  const closePopup = () => {
    const focus = railFocusRequest(), trigger = popupTrigger.current;
    setPopup(null); setRename(null);
    requestAnimationFrame(() => { focus.focus(trigger); focus.dispose(); });
  };
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(holder.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!desktop || !native) return;
    let disposed = false;
    const measure = () => {
      if (disposed || !holder.current) return;
      const box = holder.current.getBoundingClientRect(), dpi = window.devicePixelRatio;
      const regions = [...holder.current.querySelectorAll<HTMLElement>('.rail-header button, .rail-item, .rail-clip, .rail-item-menu, .rail-empty, .rail-more, .rail-popup, .rail-inline-notice')].map(element => {
        const r = element.getBoundingClientRect(), pad = 6;
        return { x: (r.x - box.x - pad) * dpi, y: (r.y - box.y - pad) * dpi, width: (r.width + pad * 2) * dpi, height: (r.height + pad * 2) * dpi };
      });
      if (!group.collapsed) for (let i = 0; i < 80; i++) {
        const t = i / 80, y = ((1 - t) ** 2 + 182 * t * (1 - t) + 5 * t ** 2) * unit;
        regions.push({ x: width * t * dpi, y: (28 + y - 10) * dpi, width: (width / 80 + 2) * dpi, height: 22 * dpi });
      }
      void invoke('rail_hit_regions', { regions }).catch(error => { if (!disposed) setNotice(String(error)); });
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(holder.current!);
    const panel = holder.current?.querySelector('.rail-popup');
    if (panel) observer.observe(panel);
    const host = holder.current;
    host?.addEventListener('rail-motion-end', measure);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); host?.removeEventListener('rail-motion-end', measure); };
  }, [desktop, popup?.mode, group.collapsed, group.items, width, unit]);
  useEffect(() => {
    const focus = railFocusRequest();
    let disposed = false, frame = 0;
    const ready = desktop && native ? invoke('rail_popup', { open: !!popup }) : Promise.resolve();
    void ready.then(() => {
      if (disposed || !popup) { focus.dispose(); return; }
      frame = requestAnimationFrame(() => {
        focus.focus(holder.current?.querySelector<HTMLElement>('.rail-popup textarea, .rail-popup input') ?? holder.current?.querySelector<HTMLElement>('.rail-popup button') ?? null);
        focus.dispose();
      });
    }).catch(error => { if (!disposed) setNotice(String(error)); focus.dispose(); });
    return () => { disposed = true; cancelAnimationFrame(frame); focus.dispose(); };
  }, [desktop, popup?.mode, popup?.item?.id]);
  useEffect(() => {
    if (!popup) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePopup();
      }
    };
    const outside = (event: Event) => {
      if (!holder.current?.contains(event.target as Node)) setPopup(null);
    };
    window.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [!!popup]);
  const perform = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      setNotice(null);
    } catch (error) {
      setNotice(String(error));
    }
  };
  const reorder = useRailReorder(controller.settings.groups, change => { void perform(() => controller.change(change)); });
  const show = (mode: Popup["mode"], item?: RailItem) => {
    if (!popup) popupTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = holder.current?.getBoundingClientRect();
    const target = item ? [...holder.current!.querySelectorAll<HTMLElement>('[data-rail-item]')].find(element => element.dataset.railItem === item.id) : holder.current?.querySelector('.rail-cord-add');
    const bounds = target?.getBoundingClientRect();
    if (host && bounds) setPopupAnchor({ x: bounds.x - host.x + bounds.width / 2, bottom: bounds.bottom - host.y });
    setRename(null);
    setPopup({ mode, item });
    setNotice(null);
  };
  const open = (item: RailItem) =>
    item.kind === 'note' ? show('note', item) : void perform(async () => { await openRailItem(item.id); setPopup(null); });
  const add = () => {
    onSelect?.(group.id);
    void show('add');
  };
  const hangingDrop = (index: number) => {
    const used = visible.reduce((total, item) => total + itemWidth(item), 0) + Math.max(0, visible.length - 1) * 26 * unit;
    const space = Math.max(0, width - 32 * unit - used) / Math.max(1, visible.length);
    const before = visible.slice(0, index).reduce((total, item) => total + itemWidth(item) + 26 * unit, 0);
    const t = (16 * unit + before + space * (index + .5) + itemWidth(visible[index]) / 2) / width;
    return ((1 - t) ** 2 + 182 * t * (1 - t) + 5 * t ** 2) * unit;
  };
  const card = (item: RailItem, compact = false, index = 0) => (
    <div
      key={item.id}
      data-rail-item={item.id}
      className={`rail-hanging rail-${item.kind}${(desktop ? desktopSelection : selected) === item.id ? " rail-selected" : ""}${compact ? " rail-compact" : ""}${reorder.target === item.id ? ' rail-reorder-target' : ''}`}
      style={{ '--hang-drop': `${compact ? 0 : hangingDrop(index)}px`, '--hang-tilt': `${[-3, 2, -2, 2, -4, 5][index % 6]}deg` } as CSSProperties}
    >
      {!compact && <span className="rail-clip" aria-hidden="true" />}
      <button
        className="rail-item"
        type="button"
        aria-label={`${item.name}，${kindLabels[item.kind]}`}
        title={item.kind === 'note' ? item.text : `${item.name}\n${item.path}\n双击或 Enter 使用系统默认方式打开，右键更多操作`}
        aria-pressed={(desktop ? desktopSelection : selected) === item.id}
        draggable={false}
        onClick={() => { setNotice(null); setDesktopSelection(item.id); onSelect?.(group.id, item.id); if (desktop && item.kind === 'note') open(item); }}
        onDoubleClick={() => { if (!desktop || item.kind !== 'note') open(item); }}
        onContextMenu={(event) => {
          event.preventDefault();
          setDesktopSelection(item.id);
          onSelect?.(group.id, item.id);
          void show("menu", item);
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
            void show("menu", item);
          }
        }}
      >
        {item.kind === 'note' ? <><span className="rail-note-kicker">随手记</span><span className="rail-note-content">{item.text}</span></> : <>
        {item.kind === 'folder' && <span className="rail-folder-paper" aria-hidden="true" />}
        {item.kind === 'file' && <span className="rail-document-top"><span>{item.path.split('.').pop()?.toUpperCase().slice(0, 8)}</span><span aria-hidden="true">↗</span></span>}
        <span className="rail-item-media">
          <RailMedia item={item} />
        </span>
        {item.kind !== 'image' && <span className="rail-item-name">{item.name}</span>}
        {item.kind === 'folder' && <span className="rail-item-detail">打开文件夹 ↗</span>}
        </>}
        {controller.missing.includes(item.id) && (
          <span className="rail-item-missing">
            <Link2 size={12} />
            需重新关联
          </span>
        )}
      </button>
      {!compact && (
        <button
          className="rail-item-menu"
          aria-label={`${item.name}的操作`}
          onClick={() => void show("menu", item)}
        >
          <Ellipsis size={13} />
        </button>
      )}
    </div>
  );
  const popupItem =
    popup?.item && group.items.find((item) => item.id === popup.item!.id);
  const popupLayout = placeRailPopup(width, popupAnchor, popup?.mode === 'menu' ? 280 : 440);
  return (
    <div
      ref={holder}
      className={`rail-surface${popup ? " rail-popup-open" : ""}${editing ? ' rail-is-editing' : ''}${group.collapsed ? ' rail-is-collapsed' : ''}`}
      data-rail-group={group.id}
      {...reorder.events}
      style={
        {
          "--rail-unit": `${unit}px`,
          minHeight: group.collapsed ? 36 : 226 * unit + 28,
        } as CSSProperties
      }
    >
      <div className="rail-design">
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
        {!group.collapsed && (
          <>
            <button className="rail-cord-add" type="button" aria-label="点击绳子添加挂件" onClick={event => { const host = holder.current!.getBoundingClientRect(); void show('add'); if (event.detail) { const t = (event.clientX - host.x) / width; setPopupAnchor({ x: event.clientX - host.x, bottom: 28 + ((1 - t) ** 2 + 182 * t * (1 - t) + 5 * t ** 2) * unit }); } }}><svg className="rail-cord" viewBox={`0 0 ${width} ${54 * unit}`} preserveAspectRatio="none" aria-hidden="true"><path className="rail-cord-shadow" d={`M 2 ${3 * unit} Q ${width / 2} ${93 * unit} ${width - 2} ${7 * unit}`} /><path d={`M 2 ${1 * unit} Q ${width / 2} ${91 * unit} ${width - 2} ${5 * unit}`} /><path className="rail-cord-hit" d={`M 2 ${1 * unit} Q ${width / 2} ${91 * unit} ${width - 2} ${5 * unit}`} /></svg></button>
            <div className="rail-items">
              {visible.map((item, index) => card(item, false, index))}
              {!group.items.length && (
                <button className="rail-empty" onClick={add}>
                  <Plus size={22} />
                  <span>挂上常用的软件、文件或照片</span>
                  <small>
                    {desktop ? "点击选择，或把文件拖到这里" : "从右侧添加，也可以直接拖入文件"}
                  </small>
                </button>
              )}
              {group.items.length > capacity && (
                <button className="rail-more" onClick={() => void show("more")}>
                  <span>+{group.items.length - capacity}</span>
                  <small>更多</small>
                </button>
              )}
            </div>
          </>
        )}
        {notice && !popup && (
          <div className="rail-inline-notice" role="alert">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice(null)}>
              <X size={12} />
            </button>
          </div>
        )}
        {popup && (
          <section
            className={`rail-popup rail-popup-${popup.mode}`}
            style={{ ...popupLayout, '--rail-popup-top': `${popupLayout.top}px` } as CSSProperties}
            aria-label={
              popup.mode === 'add' ? '添加挂件' : popup.mode === "more"
                ? "更多挂件"
                : (popupItem?.name ?? "挂件操作")
            }
          >
            <div className="rail-popup-heading">
              <strong>
                {popup.mode === 'add' ? '想挂点什么？' : popup.mode === "more"
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
            {popup.mode === 'add' && <RailAddPanel group={group} controller={controller} onDone={() => setPopup(null)} />}
            {popup.mode === 'note' && popupItem && <NoteEditor key={popupItem.id} item={popupItem} onSave={async text => { await controller.change({ type: 'item', id: popupItem.id, text }); setPopup(null) }} />}
            {popup.mode === "more" && (
              <div className="rail-overflow-items">
                {group.items.slice(capacity).map((item) => card(item, true))}
              </div>
            )}
            {popup.mode === "menu" && popupItem && (
              <div className="rail-context-actions">
                <button onClick={() => open(popupItem)}>
                  {popupItem.kind === 'note' ? '编辑便签' : '打开'}
                </button>
                {popupItem.kind !== 'note' && <><button
                  onClick={() =>
                    void perform(() => openRailItem(popupItem.id, true))
                  }
                >
                  打开所在位置
                </button>
                <button
                  onClick={() =>
                    void perform(() =>
                      navigator.clipboard.writeText(popupItem.path),
                    )
                  }
                >
                  复制路径
                </button>
                </>}
                <button onClick={() => setRename(popupItem.name)}>
                  修改显示名称
                </button>
                {popupItem.kind !== 'note' && <button
                  onClick={() => {
                    void controller.pick(
                      group.id,
                      popupItem.kind === "folder",
                      popupItem.id,
                    );
                  }}
                >
                  重新关联
                </button>}
                <button
                  onClick={() =>
                    void perform(async () => {
                      await controller.change({
                        type: "remove",
                        id: popupItem.id,
                      });
                      setPopup(null);
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
