import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { native } from "../spectrum/bridge";
import {
  changeRail,
  classifyPath,
  railDefaults,
  type RailChange,
  type RailItem,
  type RailSettings,
  type RailSnapshot,
} from "./model";
const key = "soundspectra.rail.v1";
function browserSnapshot(settings: RailSettings): RailSnapshot {
  return { settings, missing: [], desktopError: null, supported: false };
}
export async function loadRail(): Promise<RailSnapshot> {
  if (native) return invoke("rail_get");
  const stored = localStorage.getItem(key);
  const settings = stored ? JSON.parse(stored) : structuredClone(railDefaults);
  if (settings.version !== 1 || !Array.isArray(settings.groups))
    throw Error("拾光绳配置无法读取，原配置已保留");
  let renamed = false;
  for (const group of settings.groups) {
    if (group.id === "apps" && group.name === "我的晾衣绳") {
      group.name = "我的拾光绳";
      renamed = true;
    }
  }
  if (renamed) localStorage.setItem(key, JSON.stringify(settings));
  return browserSnapshot(settings);
}
function saveBrowser(settings: RailSettings) {
  localStorage.setItem(key, JSON.stringify(settings));
  window.dispatchEvent(new Event("rail-browser-changed"));
  return browserSnapshot(settings);
}
export async function mutateRail(change: RailChange): Promise<RailSnapshot> {
  if (native) return invoke("rail_change", { change });
  if (change.type === "enable" && change.enabled)
    throw Error("请在 Windows 桌面客户端中启用常驻拾光绳");
  return saveBrowser(changeRail((await loadRail()).settings, change));
}
export async function pasteRailImage(groupId: string): Promise<RailSnapshot> {
  if (!native) throw Error("粘贴图片需要 Windows 桌面客户端。");
  return invoke("rail_paste_image", { groupId });
}
export async function detachRailItem(id: string): Promise<RailSnapshot> {
  if (!native) throw Error("恢复到桌面需要 Windows 桌面客户端。");
  return invoke("rail_detach", { id });
}
let outgoingDrag = false;
export const isRailDraggingOut = () => outgoingDrag;
export async function dragRailItem(id: string): Promise<boolean> {
  if (!native) throw Error("拖出文件需要 Windows 桌面客户端。");
  if (outgoingDrag) return false;
  outgoingDrag = true;
  try {
    return await invoke("rail_drag_out", { id });
  } finally {
    outgoingDrag = false;
  }
}
export async function addRailPaths(
  groupId: string,
  paths: string[],
  replaceId?: string,
): Promise<RailSnapshot> {
  if (native)
    return invoke("rail_add_paths", {
      groupId,
      paths,
      replaceId: replaceId ?? null,
    });
  const settings = (await loadRail()).settings;
  const group = settings.groups.find((g) => g.id === groupId);
  if (!group) throw Error("找不到这组拾光绳");
  const items = paths.map((path) => {
    if (!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path))
      throw Error("请输入本地绝对路径");
    return {
      id: crypto.randomUUID(),
      path,
      name: path
        .replace(/[\\/]$/, "")
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, ""),
      kind: classifyPath(path),
      crop: "cover" as const,
    };
  });
  if (replaceId) {
    const item = settings.groups
      .flatMap((g) => g.items)
      .find((i) => i.id === replaceId);
    if (!item || items.length !== 1) throw Error("重新关联时请选择一个目标");
    item.path = items[0].path;
    item.kind = items[0].kind;
  } else {
    for (const item of items)
      if (
        !group.items.some(
          (i) => i.path.toLowerCase() === item.path.toLowerCase(),
        )
      )
        group.items.push(item);
  }
  if (group.items.length > 48) throw Error("每组最多挂载 48 个项目");
  return saveBrowser(settings);
}
export async function pickRailPaths(folder: boolean): Promise<string[]> {
  if (!native)
    throw Error("浏览器无法选择本地软件路径，请使用路径输入或桌面客户端");
  return invoke("rail_pick", { folder });
}
export async function openRailItem(id: string, reveal = false): Promise<void> {
  if (!native) throw Error("打开本地项目需要桌面客户端；浏览器只保存布局预览");
  return invoke("rail_open", { id, reveal });
}
export async function railMedia(item: RailItem): Promise<string | null> {
  if (item.kind === "note") return null;
  if (!native) return null;
  return invoke("rail_media", { id: item.id });
}
export interface DesktopEntry {
  path: string;
  name: string;
  kind: RailItem["kind"];
  icon: string | null;
}
export interface FolderEntry {
  name: string;
  relativePath: string;
  directory: boolean;
}
export interface FolderContents {
  entries: FolderEntry[];
  truncated: boolean;
  unreadable: number;
}
export async function readFolderContents(
  id: string,
  relative: string,
): Promise<FolderContents> {
  if (!native) throw Error("请在桌面客户端中展开本地文件夹。");
  return invoke("rail_folder_contents", { id, relative });
}
export async function openFolderEntry(
  id: string,
  relative: string,
  reveal = false,
): Promise<void> {
  if (!native) throw Error("打开本地项目需要桌面客户端。");
  return invoke("rail_folder_open", { id, relative, reveal });
}
export interface DesktopEntries {
  entries: DesktopEntry[];
  truncated: boolean;
  issues: string[];
}
export async function readDesktopEntries(): Promise<DesktopEntries> {
  if (!native) throw Error("请在桌面客户端中读取桌面图标。");
  return invoke("rail_desktop_entries");
}
export async function subscribeRail(callback: (value: RailSnapshot) => void) {
  if (native)
    return listen<RailSnapshot>("rail-changed", (event) =>
      callback(event.payload),
    );
  const refresh = () => {
    void loadRail()
      .then(callback)
      .catch(() => {});
  };
  window.addEventListener("storage", refresh);
  window.addEventListener("rail-browser-changed", refresh);
  return () => {
    window.removeEventListener("storage", refresh);
    window.removeEventListener("rail-browser-changed", refresh);
  };
}
