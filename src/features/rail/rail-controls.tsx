import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  GalleryHorizontalEnd,
  Link2,
  Move,
  Palette,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingToggle } from "@/components/ui/setting-toggle";
import { Dialog, Tabs } from "radix-ui";
import { ModalContent } from "@/components/ui/modal";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { IconButton } from "@/components/ui/icon-button";
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
import { RailSkinPicker } from "./rail-skin-picker";
import { RailAudioSettings } from "./rail-audio-settings";
import { RailLayoutSettings, RailNameField } from "./rail-layout-settings";
import "./rail-settings.css";

type RailSettingsTab = "items" | "appearance" | "position";
const settingsTabs = [
  { value: "items", label: "挂件", icon: GalleryHorizontalEnd },
  { value: "appearance", label: "外观", icon: Palette },
  { value: "position", label: "位置", icon: Move },
] as const;

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
  const [tab, setTab] = useState<RailSettingsTab>("items");
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
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
      const pane = row?.closest<HTMLElement>(".rail-settings-panel");
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
        setTab("items");
        setAddOpen(true);
        onSelect(created.id);
      }
    } catch {
      /* Controller displays the save error. */
    }
  };
  const closeAdd = (itemId?: string) => {
    setAddOpen(false);
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
    <RailMotionSnapshot
      beforeUpdate={() =>
        captureMotion(group?.items.map((item) => item.id) ?? [])
      }
    >
      <div ref={root} className="rail-controls inspector-content">
        <div className="inspector-heading rail-settings-heading">
          <GalleryHorizontalEnd size={16} />
          <div className="inspector-heading-copy">
            <h2 className="sr-only">桌面拾光绳</h2>
            {group ? (
              <ChoiceSelect
                className="rail-heading-selector"
                label="当前拾光绳"
                value={group.id}
                disabled={busy}
                onChange={(id) => onSelect(id)}
                options={controller.settings.groups.map((value) => ({
                  value: value.id,
                  label: value.name,
                  description: `${value.items.length} 个挂件`,
                }))}
              />
            ) : (
              <strong>桌面拾光绳</strong>
            )}
            <p>桌面拾光绳</p>
          </div>
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
                <span className="sr-only">已保存</span>
              </>
            ) : (
              "读取中…"
            )}
          </span>
          <Dialog.Root open={manageOpen} onOpenChange={setManageOpen}>
            <Dialog.Trigger asChild>
              <IconButton aria-label="分组管理" title="分组管理">
                <Settings2 size={16} />
              </IconButton>
            </Dialog.Trigger>
            <ModalContent className="module-add-dialog rail-group-dialog">
              <header>
                <div>
                  <Dialog.Title>分组管理</Dialog.Title>
                  <Dialog.Description>
                    已使用 {controller.settings.groups.length} / 4 组拾光绳
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <IconButton aria-label="关闭分组管理">
                    <X size={18} />
                  </IconButton>
                </Dialog.Close>
              </header>
              <div className="module-add-body">
                {group && (
                  <div className="rail-form-row">
                    <label htmlFor="rail-group-name">当前名称</label>
                    <RailNameField
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
                )}
                <div className="rail-group-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || controller.settings.groups.length >= 4}
                    onClick={() => {
                      setManageOpen(false);
                      void createGroup();
                    }}
                  >
                    <Plus size={14} />
                    新建拾光绳
                  </Button>
                  {group && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rail-remove-group"
                      disabled={busy || group.items.length > 0}
                      onClick={() => {
                        setManageOpen(false);
                        void change({ type: "removeGroup", id: group.id });
                      }}
                    >
                      <Trash2 size={13} />
                      移除空拾光绳
                    </Button>
                  )}
                </div>
                {group && group.items.length > 0 && (
                  <p className="rail-browser-hint">
                    移除分组前，请先移走或取下其中的挂件。
                  </p>
                )}
              </div>
            </ModalContent>
          </Dialog.Root>
        </div>
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
        {group ? (
          <Tabs.Root
            className="rail-settings-tabs"
            value={tab}
            onValueChange={(value) => setTab(value as RailSettingsTab)}
          >
            <Tabs.List
              className="module-section-nav rail-settings-tab-list"
              aria-label="拾光绳设置分类"
            >
              {settingsTabs.map(({ value, label, icon: Icon }) => (
                <Tabs.Trigger key={value} value={value}>
                  <Icon size={14} />
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content
              value="items"
              className="rail-settings-panel"
              key={`items-${group.id}`}
            >
              <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
                <div className="rail-items-toolbar">
                  <h3 className="section-label">
                    挂件列表 <span>{group.items.length} / 48</span>
                  </h3>
                  <Dialog.Trigger asChild>
                    <Button
                      className="rail-add-trigger"
                      variant="outline"
                      size="sm"
                      disabled={busy || group.items.length >= 48}
                    >
                      <Plus size={14} />
                      添加挂件
                    </Button>
                  </Dialog.Trigger>
                </div>
                <ModalContent
                  className="module-add-dialog"
                  onEscapeKeyDown={(event) => {
                    const panel = document.querySelector(
                      ".module-add-dialog .rail-add-panel",
                    );
                    if (
                      panel &&
                      !panel.classList.contains("rail-add-mode-choices")
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <header>
                    <div>
                      <Dialog.Title>添加挂件</Dialog.Title>
                      <Dialog.Description>
                        添加到「{group.name}」。
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <IconButton aria-label="关闭添加挂件">
                        <X size={18} />
                      </IconButton>
                    </Dialog.Close>
                  </header>
                  <div className="module-add-body">
                    <section aria-label="添加挂件">
                      <RailAddPanel
                        key={group.id}
                        group={group}
                        controller={controller}
                        onDone={closeAdd}
                      />
                    </section>
                    {!native && (
                      <details className="rail-path-entry">
                        <summary>输入本地路径预览布局</summary>
                        <form onSubmit={addPath}>
                          <input
                            aria-label="挂件目标路径"
                            placeholder="C:\\Users\\…\\项目文件夹\\"
                            value={targetPath}
                            onChange={(event) =>
                              setTargetPath(event.target.value)
                            }
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
              <section className="rail-items-section" aria-label="挂件管理">
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
                              <RailMedia
                                item={value}
                                unavailable={controller.missing.includes(
                                  value.id,
                                )}
                              />
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
                        disabled={busy}
                        onClick={() => setAddOpen(true)}
                      >
                        <Plus size={13} />
                        去添加
                      </Button>
                    </p>
                  )}
                </div>
              </section>
            </Tabs.Content>
            <Tabs.Content
              value="appearance"
              className="rail-settings-panel"
              key={`appearance-${group.id}`}
            >
              <SettingToggle
                className="module-enable"
                label="常驻桌面"
                accessibleLabel="显示桌面拾光绳"
                description={
                  !native ? "桌面客户端可开启；浏览器仅预览布局。" : undefined
                }
                checked={controller.settings.enabled}
                disabled={busy || !controller.supported}
                onChange={(enabled) => void change({ type: "enable", enabled })}
              />
              <RailSkinPicker
                value={group.skin}
                disabled={busy}
                onChange={(skin) =>
                  void change({ type: "group", id: group.id, skin })
                }
              />
              <RailAudioSettings
                value={group.audioSync}
                disabled={busy}
                onChange={(audioSync) =>
                  change({ type: "group", id: group.id, audioSync })
                }
              />
            </Tabs.Content>
            <Tabs.Content
              value="position"
              className="rail-settings-panel"
              key={`position-${group.id}`}
            >
              <RailLayoutSettings
                group={group}
                disabled={busy}
                change={change}
              />
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          <p className="rail-list-empty">新建一组拾光绳，开始布置桌面。</p>
        )}
      </div>
    </RailMotionSnapshot>
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
        <RailNameField
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
