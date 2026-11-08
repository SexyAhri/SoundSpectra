import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog } from 'radix-ui';
import { ModalContent } from '@/components/ui/modal';
import { ChoiceSelect } from '@/components/ui/choice-select';
import { IconButton } from '@/components/ui/icon-button';
import { Parameter } from "@/components/ui/parameter";
import { native } from "../spectrum/bridge";
import {
  kindLabels,
  type RailChange,
  type RailGroup,
  type RailItem,
} from "./model";
import { RailMedia } from "./rail-media";
import type { RailController } from "./use-rail";
import { RailAddPanel, NoteEditor } from "./rail-add-panel";
import { useRailMotion } from "./use-rail-motion";
import { RailMotionSnapshot } from "./rail-motion-snapshot";

export function RailControls({
  controller,
  selectedGroup,
  selectedItem,
  selectionRevision = 0,
  onSelect,
}: {
  controller: RailController;
  selectedGroup: string | null;
  selectedItem: string | null;
  selectionRevision?: number;
  onSelect: (groupId: string, itemId?: string) => void;
}) {
  const [targetPath, setTargetPath] = useState("");
  const [tab, setTab] = useState("items");
  const root = useRef<HTMLDivElement>(null);
  const group =
    controller.settings.groups.find((g) => g.id === selectedGroup) ??
    controller.settings.groups[0];
  const captureMotion = useRailMotion(
    root,
    ".rail-control-item",
    "controlItem",
    `${group?.id}:${tab}`,
  );
  const item = group?.items.find((i) => i.id === selectedItem);
  useEffect(() => {
    if (item) setTab("items");
  }, [item?.id, selectionRevision]);
  useEffect(() => {
    if (!item || tab !== "items") return;
    const frame = requestAnimationFrame(() => {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-control-item="${CSS.escape(item.id)}"]`,
      );
      const pane = row?.closest<HTMLElement>(".inspector-scroll");
      if (!row || !pane) return;
      if (getComputedStyle(pane).overflowY !== "auto") {
        row.scrollIntoView({ block: "nearest" });
        return;
      }
      const bounds = pane.getBoundingClientRect(),
        parentTop = row.offsetParent!.getBoundingClientRect().top;
      const start = parentTop + row.offsetTop;
      const editor = row.nextElementSibling as HTMLElement | null;
      const end = editor
        ? parentTop + editor.offsetTop + editor.offsetHeight
        : start + row.offsetHeight;
      if (start < bounds.top || end - start > pane.clientHeight)
        pane.scrollTop += start - bounds.top;
      else if (end > bounds.bottom - 4)
        pane.scrollTop += Math.ceil(end - bounds.bottom + 4);
    });
    return () => cancelAnimationFrame(frame);
  }, [item?.id, group?.id, tab]);
  const busy = !controller.loaded || controller.pending > 0;
  const change = async (value: RailChange) => {
    try {
      await controller.change(value);
    } catch {
      /* Controller keeps the actionable error visible. */
    }
  };
  const createGroup = async () => {
    try {
      const known = new Set(
        controller.settings.groups.map((value) => value.id),
      );
      const next = await controller.change({ type: "addGroup" });
      const created = next.settings.groups.find(
        (value) => !known.has(value.id),
      );
      if (created) {
        setTab("add");
        onSelect(created.id);
      }
    } catch {
      /* Controller displays the save error. */
    }
  };
  const closeAdd = (itemId?: string) => {
    setTab("items");
    if (group && itemId) {
      onSelect(group.id, itemId);
    }
  };
  const addPath = (event: FormEvent) => {
    event.preventDefault();
    if (!group || !targetPath.trim()) return;
    void controller
      .add(group.id, [targetPath.trim()])
      .then(() => setTargetPath(""))
      .catch(() => {});
  };
  return (
    <RailMotionSnapshot beforeUpdate={() => captureMotion(group?.items.map(item => item.id) ?? [])}>
    <div
      ref={root}
      className="rail-controls inspector-content"
    >
      <div className="rail-settings-header">
        <div className="rail-control-heading">
          <label className="rail-enable">
            <Switch
              aria-label="显示桌面拾光绳"
              checked={controller.settings.enabled}
              onCheckedChange={(enabled) =>
                void change({ type: "enable", enabled })
              }
              disabled={busy || !controller.supported}
            />
            <span>常驻桌面</span>
          </label>
          <span
            className={`rail-save-state${controller.error ? " is-error" : ""}`}
            role="status"
          >
            {controller.pending ? (
              "正在保存…"
            ) : controller.error ? (
              "未保存"
            ) : controller.loaded ? (
              <>
                <Check size={12} />
                已保存
              </>
            ) : (
              "读取中…"
            )}
          </span>
        </div>
        {!native && (
          <p className="rail-browser-hint">
            浏览器中可编辑；桌面客户端可常驻。
          </p>
        )}
        {(controller.error || controller.desktopError) && (
          <div className="rail-control-error" role="alert">
            <span>{controller.error || controller.desktopError}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void controller.refresh()}
            >
              <RefreshCw size={12} />
              重新读取
            </Button>
          </div>
        )}
        <div className="rail-group-label">
          <span className="section-label">我的拾光绳</span>
          <button
            type="button"
            aria-label="新建拾光绳"
            title="最多四组"
            disabled={busy || controller.settings.groups.length >= 4}
            onClick={() => void createGroup()}
          >
            <Plus size={13} />
            <span>新建</span>
          </button>
        </div>
        {group && <ChoiceSelect label="当前拾光绳" value={group.id} disabled={busy} onChange={id => onSelect(id)} options={controller.settings.groups.map(value => ({ value: value.id, label: `${value.name} · ${value.items.length} 项` }))} />}
      </div>
      {group ? (
        <>
          <Dialog.Root open={tab === 'add'} onOpenChange={open => setTab(open ? 'add' : 'items')}>
            <Dialog.Trigger asChild><Button className="rail-add-trigger" variant="outline" disabled={busy}><Plus size={14} />添加挂件</Button></Dialog.Trigger>
            <ModalContent className="module-add-dialog" onEscapeKeyDown={event => {
              const panel = document.querySelector('.module-add-dialog .rail-add-panel');
              if (panel && !panel.classList.contains('rail-add-mode-choices')) {
                event.preventDefault();
              }
            }}>
              <header><div><Dialog.Title>添加挂件</Dialog.Title><Dialog.Description>添加到「{group.name}」。</Dialog.Description></div><Dialog.Close asChild><IconButton aria-label="关闭添加挂件"><X size={18} /></IconButton></Dialog.Close></header>
              <div className="module-add-body">
              <section aria-label="添加挂件">
                <RailAddPanel key={group.id} group={group} controller={controller} onDone={closeAdd} />
              </section>
              {!native && (
              <details className="rail-path-entry">
                <summary>
                  输入本地路径预览布局
                </summary>
                <form onSubmit={addPath}>
                  <input
                    aria-label="挂件目标路径"
                    placeholder="C:\\Users\\…\\项目文件夹\\"
                    value={targetPath}
                    onChange={(event) => setTargetPath(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    disabled={busy || !targetPath.trim()}
                  >
                    挂上去
                  </Button>
                </form>
              </details>
              )}
              </div>
            </ModalContent>
          </Dialog.Root>
            <section className="module-section rail-items-section" aria-label="挂件管理">
              <div className="rail-list-heading">
                <span className="section-label">挂件列表</span>
                <span>{group.items.length} / 48</span>
              </div>
              <div
                className="rail-control-list"
                aria-label={`${group.name}的挂件`}
              >
                {group.items.length ? (
                  group.items.map((value, index) => (
                    <Fragment key={value.id}>
                      <div
                        data-control-item={value.id}
                        className={`rail-control-item${item?.id === value.id ? " is-selected" : ""}`}
                      >
                        <button
                          className="rail-control-select"
                          title={`${value.name}\nAlt + ↑ / ↓ 调整顺序`}
                          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                          aria-pressed={item?.id === value.id}
                          onKeyDown={(event) => {
                            if (
                              !event.altKey ||
                              busy ||
                              !["ArrowUp", "ArrowDown"].includes(event.key)
                            )
                              return;
                            event.preventDefault();
                            const target =
                              index + (event.key === "ArrowUp" ? -1 : 1);
                            if (target >= 0 && target < group.items.length)
                              void change({
                                type: "move",
                                id: value.id,
                                groupId: group.id,
                                index: target,
                              });
                          }}
                          onClick={() =>
                            onSelect(
                              group.id,
                              item?.id === value.id ? undefined : value.id,
                            )
                          }
                        >
                          <span className="rail-control-icon">
                            <RailMedia item={value} unavailable={controller.missing.includes(value.id)} />
                          </span>
                          <span>
                            <strong>{value.name}</strong>
                            <small>
                              {controller.missing.includes(value.id)
                                ? "目标失效，请重新关联"
                                : kindLabels[value.kind]}
                            </small>
                          </span>
                        </button>
                      </div>
                      {item?.id === value.id && (
                        <ItemControls
                          key={item.id + item.path}
                          item={item}
                          group={group}
                          controller={controller}
                          change={change}
                          disabled={busy}
                          onMove={(id) => onSelect(id, item.id)}
                          onClose={() => {
                            onSelect(group.id);
                            requestAnimationFrame(() =>
                              root.current
                                ?.querySelector<HTMLButtonElement>(
                                  `[data-control-item="${CSS.escape(item.id)}"] .rail-control-select`,
                                )
                                ?.focus({ preventScroll: true }),
                            );
                          }}
                        />
                      )}
                    </Fragment>
                  ))
                ) : (
                  <p className="rail-list-empty">
                    还没有挂件
                    <small>从桌面批量选择，或将文件拖到预览的绳子上。</small>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTab("add")}
                    >
                      <Plus size={13} />
                      去添加
                    </Button>
                  </p>
                )}
              </div>
            </section>
            <details className="module-advanced rail-layout-advanced"><summary>布局与分组设置</summary>
              <section
                className="rail-layout-settings"
                aria-label="拾光绳位置与尺寸"
              >
                <div className="rail-form-row">
                  <label htmlFor="rail-group-name">拾光绳名称</label>
                  <NameField
                    key={group.id + group.name}
                    id="rail-group-name"
                    value={group.name}
                    max={40}
                    disabled={busy}
                    onSave={(name) =>
                      void change({ type: "group", id: group.id, name })
                    }
                  />
                </div>
                <h3 className="section-label">位置与尺寸</h3>
                <div
                  className="rail-position-presets"
                  role="group"
                  aria-label="拾光绳靠边预设"
                >
                  {[
                    { label: "左上", x: 0.06, y: 0.12 },
                    { label: "右上", x: 0.94 - group.width, y: 0.12 },
                    { label: "左下", x: 0.06, y: 0.58 },
                    { label: "右下", x: 0.94 - group.width, y: 0.58 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      disabled={busy}
                      onClick={() =>
                        void change({
                          type: "group",
                          id: group.id,
                          x: Math.max(0, preset.x),
                          y: preset.y,
                        })
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <RailParameter
                  key={`${group.id}-width`}
                  label="拾光绳宽度"
                  value={group.width * 100}
                  min={20}
                  max={100}
                  disabled={busy}
                  onSave={(value) =>
                    change({ type: "group", id: group.id, width: value / 100 })
                  }
                />
                <RailParameter
                  key={`${group.id}-x`}
                  label="距屏幕左侧"
                  value={group.x * 100}
                  min={0}
                  max={Math.round((1 - group.width) * 100)}
                  disabled={busy}
                  onSave={(value) =>
                    change({ type: "group", id: group.id, x: value / 100 })
                  }
                />
                <RailParameter
                  key={`${group.id}-y`}
                  label="距屏幕顶部"
                  value={group.y * 100}
                  min={0}
                  max={75}
                  disabled={busy}
                  onSave={(value) =>
                    change({ type: "group", id: group.id, y: value / 100 })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="rail-remove-group"
                  disabled={busy || group.items.length > 0}
                  onClick={() =>
                    void change({ type: "removeGroup", id: group.id })
                  }
                >
                  <Trash2 size={13} />
                  移除空拾光绳
                </Button>
              </section>
            </details>
        </>
      ) : (
        <p className="rail-list-empty">新建一组拾光绳，开始布置桌面。</p>
      )}
    </div>
    </RailMotionSnapshot>
  );
}
function RailParameter({
  value,
  onSave,
  ...props
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <Parameter
      {...props}
      value={draft}
      onChange={(next) => {
        editing.current = true;
        setDraft(next);
      }}
      onCommit={(next) => {
        void onSave(next).finally(() => {
          editing.current = false;
          setDraft(latest.current);
        });
      }}
    />
  );
}
function NameField({
  id,
  value,
  onSave,
  disabled,
  max = 120,
}: {
  id: string;
  value: string;
  onSave: (name: string) => void;
  disabled: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  return (
    <input
      id={id}
      value={draft}
      maxLength={max}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
function ItemControls({
  item,
  group,
  controller,
  change,
  disabled,
  onClose,
  onMove,
}: {
  item: RailItem;
  group: RailGroup;
  controller: RailController;
  change: (value: RailChange) => Promise<void>;
  disabled: boolean;
  onClose: () => void;
  onMove: (groupId: string) => void;
}) {
  return (
    <section className="rail-item-controls" aria-label="选中挂件属性">
      <div className="rail-item-controls-heading">
        <span className="section-label">{kindLabels[item.kind]}设置</span>
        <button type="button" aria-label="收起挂件属性" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="rail-form-row">
        <label htmlFor="rail-item-name">显示名称</label>
        <NameField
          key={item.name}
          id="rail-item-name"
          value={item.name}
          disabled={disabled}
          onSave={(name) => void change({ type: "item", id: item.id, name })}
        />
      </div>
      {controller.settings.groups.length > 1 && (
        <div className="rail-form-row">
          <label htmlFor="rail-item-group">所在拾光绳</label>
          <select
            id="rail-item-group"
            value={group.id}
            disabled={disabled}
            onChange={(event) => {
              const groupId = event.target.value;
              void controller
                .change({ type: "move", id: item.id, groupId, index: 48 })
                .then(() => onMove(groupId))
                .catch(() => {});
            }}
          >
            {controller.settings.groups.map((g) => (
              <option
                key={g.id}
                value={g.id}
                disabled={g.id !== group.id && g.items.length >= 48}
              >
                {g.name}
                {g.items.length >= 48 ? "（已满）" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {item.kind === "image" && (
        <div className="rail-form-row">
          <label htmlFor="rail-image-crop">照片显示</label>
          <select
            id="rail-image-crop"
            value={item.crop}
            disabled={disabled}
            onChange={(event) =>
              void change({
                type: "item",
                id: item.id,
                crop: event.target.value as RailItem["crop"],
              })
            }
          >
            <option value="cover">填满相框</option>
            <option value="contain">完整显示</option>
          </select>
        </div>
      )}
      {item.kind === "note" ? (
        <section className="rail-popup rail-add-inline">
          <NoteEditor
            item={item}
            onSave={(text) =>
              controller.change({ type: "item", id: item.id, text })
            }
          />
        </section>
      ) : (
        <details
          className="rail-target-settings rail-path-entry"
          open={controller.missing.includes(item.id) || undefined}
        >
          <summary>目标与重新关联</summary>
          <p className="rail-target-path" title={item.path}>
            {item.path}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !native}
            onClick={() =>
              void controller.pick(group.id, item.kind === "folder", item.id)
            }
          >
            <Link2 size={13} />
            重新关联目标
          </Button>
        </details>
      )}
      <div className="rail-item-remove">
        <Button
          className="rail-unmount"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void change({ type: "remove", id: item.id })}
        >
          <Trash2 size={13} />
          取消挂载
        </Button>
        <small className="rail-control-note">
          {item.kind === "note"
            ? "移除这张便签"
            : item.desktopManaged
              ? "取下后恢复桌面显示"
              : "保留原文件"}
        </small>
      </div>
    </section>
  );
}
