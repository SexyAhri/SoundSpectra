import { SearchField } from "@/components/ui/search-field";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { describeError } from "../spectrum/bridge";
import {
  openFolderEntry,
  readFolderContents,
  type FolderContents,
  type FolderEntry,
} from "./client";
import type { RailItem } from "./model";
import { railFocusRequest } from "./focus";

export function FolderBrowser({ item }: { item: RailItem }) {
  const [relative, setRelative] = useState("");
  const [query, setQuery] = useState("");
  const [revision, refresh] = useState(0);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, select] = useState<FolderEntry | null>(null);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<ReturnType<typeof railFocusRequest> | null>(null);
  const parts = relative.split(/[\\/]/).filter(Boolean);

  useEffect(() => {
    let disposed = false;
    generation.current++;
    setLoading(true);
    setError(null);
    setContents(null);
    select(null);
    if (list.current) list.current.scrollTop = 0;
    void readFolderContents(item.id, relative)
      .then((value) => {
        if (!disposed) setContents(value);
      })
      .catch((reason) => {
        if (!disposed) setError(describeError(reason));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      generation.current++;
    };
  }, [item.id, item.path, relative, revision]);

  useEffect(() => {
    if (loading || !pendingFocus.current) return;
    pendingFocus.current.focus(
      list.current?.querySelector<HTMLButtonElement>(".rail-folder-entry") ??
        list.current,
    );
    pendingFocus.current.dispose();
    pendingFocus.current = null;
  }, [loading]);
  useEffect(() => () => pendingFocus.current?.dispose(), []);

  const navigate = (path: string, keyboard = false) => {
    if (busy.current || path === relative) return;
    pendingFocus.current?.dispose();
    pendingFocus.current = keyboard ? railFocusRequest() : null;
    setQuery("");
    setRelative(path);
  };
  const systemOpen = async (path: string, reveal = false) => {
    if (busy.current) return;
    const request = generation.current;
    busy.current = true;
    setOpening(true);
    setError(null);
    try {
      await openFolderEntry(item.id, path, reveal);
    } catch (reason) {
      if (request === generation.current) setError(describeError(reason));
    } finally {
      busy.current = false;
      setOpening(false);
    }
  };
  const activate = (entry: FolderEntry, keyboard = false) => {
    if (entry.directory) navigate(entry.relativePath, keyboard);
    else void systemOpen(entry.relativePath);
  };
  const entries =
    contents?.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  const moveSelection = (index: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index));
    if (entries[next]) {
      select(entries[next]);
      list.current
        ?.querySelectorAll<HTMLButtonElement>(".rail-folder-entry")
        [next]?.focus();
    }
  };

  return (
    <div className="rail-folder-browser" aria-busy={loading || opening}>
      <div className="rail-folder-toolbar">
        <button
          type="button"
          aria-label="返回上一级"
          title="返回上一级"
          disabled={!parts.length || opening}
          onClick={() => navigate(parts.slice(0, -1).join("/"))}
        >
          <ArrowUp size={14} />
        </button>
        <nav aria-label="文件夹位置">
          <button
            type="button"
            disabled={opening}
            aria-current={!parts.length ? "location" : undefined}
            onClick={() => navigate("")}
          >
            {item.name}
          </button>
          {parts.map((part, index) => (
            <span key={index}>
              <ChevronRight size={11} aria-hidden="true" />
              <button
                type="button"
                disabled={opening}
                aria-current={
                  index === parts.length - 1 ? "location" : undefined
                }
                onClick={() => navigate(parts.slice(0, index + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          aria-label="刷新文件夹"
          title="刷新文件夹"
          disabled={loading || opening}
          onClick={() => refresh((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          aria-label="在资源管理器中打开当前文件夹"
          title="在资源管理器中打开"
          disabled={opening}
          onClick={() => void systemOpen(relative)}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      <SearchField
        className="rail-desktop-search"
        aria-label="搜索当前文件夹"
        placeholder="搜索当前文件夹…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          select(null);
        }}
      />
      {error && (
        <div className="rail-folder-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={loading || opening}
            onClick={() => refresh((value) => value + 1)}
          >
            重新读取
          </button>
        </div>
      )}
      <div
        ref={list}
        className="rail-folder-list"
        role="group"
        aria-label="文件夹内容"
        tabIndex={-1}
      >
        {loading ? (
          <p className="rail-add-status" role="status">
            <LoaderCircle size={13} className="spinning" />
            正在读取文件夹…
          </p>
        ) : contents && !entries.length ? (
          <p className="rail-add-status" role="status">
            {query.trim() ? "没有匹配的项目" : "这个文件夹是空的"}
          </p>
        ) : (
          entries.map((entry, index) => (
            <button
              key={entry.relativePath}
              type="button"
              className="rail-folder-entry"
              title={entry.name}
              aria-label={`${entry.name}，${entry.directory ? "文件夹" : "文件"}`}
              aria-pressed={selected?.relativePath === entry.relativePath}
              disabled={opening}
              onClick={() => select(entry)}
              onDoubleClick={() => activate(entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  activate(entry, true);
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelection(index + (event.key === "ArrowDown" ? 1 : -1));
                }
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  moveSelection(event.key === "Home" ? 0 : entries.length - 1);
                }
                if (event.altKey && event.key === "ArrowLeft") {
                  event.preventDefault();
                  navigate(parts.slice(0, -1).join("/"), true);
                }
              }}
            >
              {entry.directory ? (
                <Folder size={17} aria-hidden="true" />
              ) : (
                <File size={17} aria-hidden="true" />
              )}
              <span>{entry.name}</span>
              {entry.directory && <ChevronRight size={13} aria-hidden="true" />}
            </button>
          ))
        )}
      </div>
      {contents && (
        <div className="rail-folder-footer">
          <span>
            {opening
              ? "正在打开…"
              : `${entries.length} 项${query.trim() ? "匹配" : ""}`}
          </span>
          <span>双击或 Enter 打开</span>
        </div>
      )}
      {(contents?.truncated || !!contents?.unreadable) && (
        <p className="rail-folder-hint">
          {contents.truncated
            ? "仅显示前 200 项，完整内容请在资源管理器中查看。"
            : ""}
          {contents.unreadable
            ? `有 ${contents.unreadable} 项暂时无法读取。`
            : ""}
        </p>
      )}
      {selected && (
        <div className="rail-folder-actions">
          <button
            type="button"
            disabled={opening}
            onClick={() => activate(selected)}
          >
            {selected.directory ? "进入文件夹" : "打开文件"}
          </button>
          <button
            type="button"
            disabled={opening}
            onClick={() => void systemOpen(selected.relativePath, true)}
          >
            打开所在位置
          </button>
        </div>
      )}
    </div>
  );
}
