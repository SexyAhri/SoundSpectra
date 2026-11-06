export type RailKind = "app" | "file" | "folder" | "image" | "note";
export interface RailItem {
  id: string;
  name: string;
  path: string;
  kind: RailKind;
  crop: "cover" | "contain";
  text?: string;
  desktopManaged?: boolean;
}
export interface RailGroup {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  collapsed: boolean;
  items: RailItem[];
}
export interface RailSettings {
  version: 1;
  enabled: boolean;
  groups: RailGroup[];
}
export interface RailSnapshot {
  settings: RailSettings;
  missing: string[];
  desktopError: string | null;
  supported: boolean;
}
export type RailChange =
  | { type: "enable"; enabled: boolean }
  | {
      type: "group";
      id: string;
      name?: string;
      x?: number;
      y?: number;
      width?: number;
      collapsed?: boolean;
    }
  | { type: "addGroup" }
  | { type: "removeGroup"; id: string }
  | { type: "addNote"; groupId: string; text: string }
  | {
      type: "item";
      id: string;
      name?: string;
      crop?: "cover" | "contain";
      text?: string;
    }
  | { type: "move"; id: string; groupId: string; index: number }
  | { type: "remove"; id: string };
export const railDefaults: RailSettings = {
  version: 1,
  enabled: false,
  groups: [
    {
      id: "apps",
      name: "我的拾光绳",
      x: 0.01,
      y: 0.18,
      width: 0.98,
      collapsed: false,
      items: [],
    },
  ],
};
export const kindLabels: Record<RailKind, string> = {
  app: "软件",
  file: "文件",
  folder: "文件夹",
  image: "图片",
  note: "便签",
};
export function classifyPath(path: string): RailKind {
  if (/[\\/]$/.test(path)) return "folder";
  if (/\.(exe|lnk|appref-ms|app)$/i.test(path)) return "app";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) return "image";
  return "file";
}
export function changeRail(
  settings: RailSettings,
  change: RailChange,
): RailSettings {
  const next = structuredClone(settings);
  if (change.type === "enable") next.enabled = change.enabled;
  if (change.type === "group") {
    const group = next.groups.find((g) => g.id === change.id);
    if (!group) throw Error("找不到这组拾光绳");
    const { type: _, id: __, ...patch } = change;
    Object.assign(group, patch);
    group.x = Math.max(0, Math.min(group.x, 1 - group.width));
    if (!group.name.trim() || group.name.length > 40)
      throw Error("拾光绳名称需为 1～40 个字符");
  }
  if (change.type === "addGroup") {
    if (next.groups.length >= 4) throw Error("最多放置四组拾光绳");
    next.groups.push({
      id: crypto.randomUUID(),
      name: "新拾光绳",
      x: 0.54,
      y: 0.54,
      width: 0.38,
      collapsed: false,
      items: [],
    });
  }
  if (change.type === "removeGroup") {
    if (next.groups.find((g) => g.id === change.id)?.items.length)
      throw Error("请先移走或取消挂载这一组的项目");
    next.groups = next.groups.filter((g) => g.id !== change.id);
  }
  if (change.type === "item") {
    const item = next.groups
      .flatMap((g) => g.items)
      .find((i) => i.id === change.id);
    if (!item) throw Error("找不到这个挂件");
    if (change.name !== undefined) {
      if (!change.name.trim() || change.name.length > 120)
        throw Error("显示名称需为 1～120 个字符");
      item.name = change.name.trim();
    }
    if (change.crop) item.crop = change.crop;
    if (change.text !== undefined) {
      if (
        item.kind !== "note" ||
        !change.text.trim() ||
        change.text.length > 2000
      )
        throw Error("便签需为 1～2000 个字符");
      item.text = change.text.trim();
    }
  }
  if (change.type === "addNote") {
    const group = next.groups.find((g) => g.id === change.groupId);
    if (!group) throw Error("找不到这组拾光绳");
    if (group.items.length >= 48) throw Error("这一组已经放满了");
    if (!change.text.trim() || change.text.length > 2000)
      throw Error("便签需为 1～2000 个字符");
    group.items.push({
      id: crypto.randomUUID(),
      name: change.text.trim().split("\n")[0].slice(0, 18),
      path: "",
      kind: "note",
      crop: "cover",
      text: change.text.trim(),
    });
  }
  if (change.type === "move") {
    const target = next.groups.find((g) => g.id === change.groupId);
    const item = next.groups
      .flatMap((g) => g.items)
      .find((i) => i.id === change.id);
    if (!item || !target) throw Error("找不到挂件或目标拾光绳");
    if (
      target.items.length >= 48 &&
      !target.items.some((i) => i.id === item.id)
    )
      throw Error("这一组已经放满了");
    next.groups.forEach((g) => {
      g.items = g.items.filter((i) => i.id !== item.id);
    });
    target.items.splice(
      Math.max(0, Math.min(change.index, target.items.length)),
      0,
      item,
    );
  }
  if (change.type === "remove")
    next.groups.forEach((g) => {
      g.items = g.items.filter((i) => i.id !== change.id);
    });
  return next;
}
