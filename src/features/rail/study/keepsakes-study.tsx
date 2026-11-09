import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RailSurface } from "../rail-surface";
import {
  changeRail,
  type RailSettings,
  type RailSnapshot,
  type RailSkin,
} from "../model";
import type { RailController } from "../use-rail";
import { railSkinCatalog } from "../skin-theme";
import "../../../index.css";
import "../rail.css";
import "./keepsakes-study.css";

// Isolated samples: real presentation and reorder behavior, no desktop file operations.
const initial: RailSettings = {
  version: 1,
  enabled: false,
  groups: [
    {
      id: "study-tools",
      name: "桌边常用",
      skin: "floral",
      x: 0,
      y: 0,
      width: 1,
      collapsed: false,
      items: [
        {
          id: "study-editor",
          name: "文字编辑器",
          kind: "app",
          path: "示例软件.exe",
          crop: "contain",
        },
        {
          id: "study-project",
          name: "周末的灵感与收藏",
          kind: "folder",
          path: "示例文件夹/",
          crop: "contain",
        },
        {
          id: "study-reading",
          name: "十一月阅读手记.txt",
          kind: "file",
          path: "示例文件.txt",
          crop: "contain",
        },
      ],
    },
    {
      id: "study-memories",
      name: "留住片刻",
      skin: "floral",
      x: 0,
      y: 0,
      width: 1,
      collapsed: false,
      items: [
        {
          id: "study-photo",
          name: "午后的一张照片",
          kind: "image",
          path: "示例照片.jpg",
          crop: "cover",
        },
        {
          id: "study-note",
          name: "小小的愿望",
          kind: "note",
          path: "",
          crop: "cover",
          text: "慢一点，\n把喜欢的时光\n挂在这里。",
        },
      ],
    },
  ],
};

function KeepsakesStudy() {
  const [settings, setSettings] = useState(initial);
  const [light, setLight] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [selected, select] = useState<string | null>(null);
  const snapshot = (next = settings): RailSnapshot => ({
    settings: next,
    missing: [],
    desktopError: null,
    supported: false,
  });
  const unsupported = async (): Promise<RailSnapshot> => {
    throw new Error("这是材质示例，请在主工作台添加真实项目。");
  };
  const controller: RailController = {
    ...snapshot(),
    loaded: true,
    pending: 0,
    error: null,
    change: async (change) => {
      const next = changeRail(settings, change);
      setSettings(next);
      return snapshot(next);
    },
    add: unsupported,
    pasteImage: unsupported,
    detach: unsupported,
    pick: async () => {
      await unsupported();
    },
    refresh: async () => {},
    flush: async () => {},
  };
  const skin = (value: RailSkin) =>
    setSettings((current) => ({
      ...current,
      groups: current.groups.map((group) => ({ ...group, skin: value })),
    }));
  return (
    <main className="rail-study" data-light={light}>
      <header>
        <div>
          <h1>把日常，挂成一小片风景。</h1>
          <p>拾光绳材质预览 · 示例内容，未连接本地软件</p>
        </div>
        <div className="rail-study-options">
          {railSkinCatalog.map((theme) => (
            <button
              key={theme.id}
              aria-pressed={settings.groups[0].skin === theme.id}
              onClick={() => skin(theme.id)}
            >
              {theme.name}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={light}
              onChange={(event) => setLight(event.target.checked)}
            />
            浅色背景
          </label>
          <label>
            <input
              type="checkbox"
              checked={narrow}
              onChange={(event) => setNarrow(event.target.checked)}
            />
            小尺寸
          </label>
        </div>
      </header>
      <section className="rail-study-scene" aria-label="拾光绳材质示例">
        {settings.groups.map((group) => (
          <div
            key={group.id}
            className="rail-study-row"
            style={{ maxWidth: narrow ? 420 : 1000 }}
          >
            <RailSurface
              group={group}
              controller={controller}
              selected={selected}
              onSelect={(_, id) => select(id ?? null)}
            />
          </div>
        ))}
      </section>
      <p className="rail-study-hint">
        拖动纸签调整顺序，悬停查看纸角，点击组名旁的箭头收起。照片位置在浏览器中显示类型图标。
      </p>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<KeepsakesStudy />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
