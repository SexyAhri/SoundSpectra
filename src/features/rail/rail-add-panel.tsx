import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  ArrowLeft,
  ClipboardPaste,
  FilePlus2,
  FolderPlus,
  Monitor,
  RefreshCw,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { native } from "../spectrum/bridge";
import {
  pickRailPaths,
  readDesktopEntries,
  type DesktopEntries,
} from "./client";
import type { RailGroup } from "./model";
import type { RailController } from "./use-rail";
import { NoteEditor } from "./note-editor";
import { railFocusRequest } from "./focus";
export { NoteEditor } from "./note-editor";

export type AddMode = "choices" | "desktop" | "note";
export function RailAddPanel({
  group,
  controller,
  onDone,
  initialMode = "choices",
}: {
  group: RailGroup;
  controller: RailController;
  onDone: (itemId?: string) => void;
  initialMode?: AddMode;
}) {
  const [mode, setMode] = useState<AddMode>(initialMode);
  const [data, setData] = useState<DesktopEntries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const available =
    data?.entries.filter(
      (entry) =>
        !group.items.some(
          (item) => item.path.toLowerCase() === entry.path.toLowerCase(),
        ),
    ) ?? [];
  const chosen = selected.filter((path) =>
    available.some((entry) => entry.path === path),
  );
  const filtered =
    data?.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  const visibleAvailable = available.filter((entry) =>
    filtered.some((value) => value.path === entry.path),
  );
  const visibleChosen = visibleAvailable.filter((entry) =>
    chosen.includes(entry.path),
  );
  const remaining = 48 - group.items.length;
  const visibleLimit = Math.min(
    visibleAvailable.length,
    Math.max(0, remaining - (chosen.length - visibleChosen.length)),
  );
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        visibleChosen.length > 0 && visibleChosen.length < visibleLimit;
  }, [visibleChosen.length, visibleLimit]);
  useEffect(() => {
    if (mode !== "desktop") return;
    let disposed = false;
    const focus = railFocusRequest();
    let frame = 0;
    setData(null);
    setError(null);
    void readDesktopEntries()
      .then((value) => {
        if (disposed) return;
        setData(value);
        frame = requestAnimationFrame(() => {
          focus.focus(search.current);
          focus.dispose();
        });
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
        focus.dispose();
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      focus.dispose();
    };
  }, [mode, retry]);
  const pick = async (folder = false) => {
    const paths = await pickRailPaths(folder);
    if (!paths.length) return;
    const next = await controller.add(group.id, paths);
    onDone(
      next.settings.groups
        .find((value) => value.id === group.id)
        ?.items.find((value) => !group.items.some((old) => old.id === value.id))
        ?.id,
    );
  };
  const perform = async (operation: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      ref={panel}
      className={`rail-add-panel rail-add-mode-${mode}`}
      onKeyDown={event => {
        if (event.key !== "Escape" || mode === "choices" || saving) return;
        event.stopPropagation();
        const source = mode;
        setMode("choices");
        requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`[data-add-mode="${source}"]`)?.focus({ preventScroll: true }));
      }}
    >
      {mode !== "choices" && (
        <button
          className="rail-add-back"
          type="button"
          disabled={saving}
          onClick={() => {
            setMode("choices");
            setError(null);
          }}
        >
          <ArrowLeft size={13} />
          添加其他内容
        </button>
      )}
      {mode === "choices" && (
        <div className="rail-add-choices">
          <button type="button" data-add-mode="desktop" disabled={saving || controller.pending > 0 || remaining <= 0} onClick={() => setMode("desktop")}>
            <Monitor />
            <span>
              从桌面添加
            </span>
          </button>
          <button
            type="button"
            disabled={!native || saving || controller.pending > 0 || remaining <= 0}
            onClick={() => void perform(() => pick())}
          >
            <AppWindow />
            <span>
              软件 / 文件 / 照片
            </span>
          </button>
          <button
            type="button"
            disabled={
              !controller.supported ||
              saving ||
              controller.pending > 0 ||
              remaining <= 0
            }
            onClick={() =>
              void perform(async () => {
                const next = await controller.pasteImage(group.id);
                onDone(
                  next.settings.groups
                    .find((value) => value.id === group.id)
                    ?.items.find(
                      (value) =>
                        !group.items.some((old) => old.id === value.id),
                    )?.id,
                );
              })
            }
          >
            <ClipboardPaste />
            <span>
              粘贴图片
            </span>
          </button>
          <button
            type="button"
            data-add-mode="note"
            disabled={saving || controller.pending > 0 || remaining <= 0}
            onClick={() => {
              setMode("note");
              setError(null);
            }}
          >
            <StickyNote />
            <span>
              写便签
            </span>
          </button>
          <button
            type="button"
            disabled={!native || saving || controller.pending > 0 || remaining <= 0}
            onClick={() => void perform(() => pick(true))}
          >
            <FolderPlus />
            <span>文件夹</span>
          </button>
        </div>
      )}
      {mode === "desktop" && (
        <>
          <div className="rail-desktop-picker-heading">
            <span>桌面上的东西</span>
            <button
              type="button"
              aria-label="刷新桌面图标"
              disabled={saving}
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {!data && !error && (
            <p className="rail-add-status" role="status">
              正在读取桌面图标…
            </p>
          )}
          {data && (
            <>
              <div className="rail-desktop-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={search}
                  type="search"
                  aria-label="搜索桌面图标"
                  placeholder="搜索桌面图标…"
                  value={query}
                  disabled={saving}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => {
                      setQuery("");
                      search.current?.focus();
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="rail-desktop-picker-tools">
                <label>
                  <input
                    ref={selectAll}
                    type="checkbox"
                    aria-label="全选可添加的桌面图标"
                    checked={
                      visibleLimit > 0 && visibleChosen.length >= visibleLimit
                    }
                    disabled={
                      !visibleAvailable.length ||
                      saving ||
                      (chosen.length >= remaining && !visibleChosen.length)
                    }
                    onChange={(event) => {
                      const others = chosen.filter(
                        (path) =>
                          !visibleAvailable.some(
                            (entry) => entry.path === path,
                          ),
                      );
                      setSelected(
                        event.target.checked
                          ? [
                              ...others,
                              ...visibleAvailable
                                .slice(
                                  0,
                                  Math.max(0, remaining - others.length),
                                )
                                .map((entry) => entry.path),
                            ]
                          : others,
                      );
                    }}
                  />
                  {query ? "选择搜索结果" : "全选"}
                </label>
                <span>
                  {chosen.length} 项已选 · 还可挂 {remaining} 项
                </span>
              </div>
              <div className="rail-desktop-picker-list">
                {filtered.map((entry) => {
                  const mounted = !available.some(
                    (candidate) => candidate.path === entry.path,
                  );
                  return (
                    <label
                      key={entry.path}
                      className={mounted ? "is-mounted" : ""}
                      title={entry.path}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择桌面项目${entry.name}`}
                        disabled={
                          mounted ||
                          saving ||
                          (chosen.length >= remaining &&
                            !chosen.includes(entry.path))
                        }
                        checked={mounted || chosen.includes(entry.path)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, entry.path]
                              : current.filter((path) => path !== entry.path),
                          )
                        }
                      />
                      {entry.icon ? (
                        <img src={entry.icon} alt="" />
                      ) : (
                        <FilePlus2 aria-hidden="true" />
                      )}
                      <span>{entry.name}</span>
                      {mounted && <small>已挂上</small>}
                    </label>
                  );
                })}
              </div>
              {!!data.entries.length && !filtered.length && (
                <p className="rail-add-status" role="status">
                  没有找到“{query.trim()}”，换个名称试试。
                </p>
              )}
              {!data.entries.length && (
                <p className="rail-add-status">
                  桌面上还没有可添加的文件或快捷方式。
                </p>
              )}
              {data.issues.map((issue) => (
                <p className="rail-popup-error" key={issue}>
                  {issue}
                </p>
              ))}
              {data.truncated && (
                <p className="rail-add-status">
                  显示前 256 项，其他项目可以直接拖到绳子上。
                </p>
              )}
              {chosen.length > remaining && (
                <p className="rail-popup-error" role="alert">
                  这组还能挂 {remaining} 项，请减少选择或新建一组。
                </p>
              )}
              <div className="rail-desktop-picker-footer">
                <span role="status">
                  {chosen.length >= remaining && remaining > 0
                    ? "已达到这组的可用数量"
                    : query && chosen.length > visibleChosen.length
                      ? `另有 ${chosen.length - visibleChosen.length} 项已选内容不在当前结果中`
                      : "已挂上的项目不会重复添加"}
                </span>
                <div>
                  {chosen.length > 0 && (
                    <button
                      type="button"
                      className="rail-clear-selection"
                      disabled={saving}
                      onClick={() => setSelected([])}
                    >
                      清空选择
                    </button>
                  )}
                  <button
                    className="rail-add-submit"
                    type="button"
                    disabled={
                      saving || !chosen.length || chosen.length > remaining
                    }
                    onClick={() =>
                      void perform(async () => {
                        const next = await controller.add(group.id, chosen);
                        onDone(
                          next.settings.groups
                            .find((value) => value.id === group.id)
                            ?.items.find(
                              (value) =>
                                !group.items.some((old) => old.id === value.id),
                            )?.id,
                        );
                      })
                    }
                  >
                    {saving ? "正在挂上…" : `挂上所选 ${chosen.length} 项`}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {mode === "note" && (
        <NoteEditor
          autoFocus
          draftKey={`new-${group.id}`}
          onSave={async (text) => {
            const next = await controller.change({
              type: "addNote",
              groupId: group.id,
              text,
            });
            onDone(
              next.settings.groups
                .find((value) => value.id === group.id)
                ?.items.find(
                  (value) => !group.items.some((old) => old.id === value.id),
                )?.id,
            );
          }}
        />
      )}
      {error && (
        <div className="rail-popup-error" role="alert">
          {error}
          {mode === "desktop" && (
            <button
              className="rail-add-back"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              重新读取
            </button>
          )}
        </div>
      )}
    </div>
  );
}
