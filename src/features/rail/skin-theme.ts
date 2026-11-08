import type { CSSProperties } from "react";
import { railSkin, railSkins, type RailSkin } from "./model";

type Tokens = Readonly<Record<`--rail-${string}`, string>>;

/** Built-in recipes only. Persist the ID, never CSS or simulation state. */
export interface RailSkinTheme {
  readonly id: RailSkin;
  readonly name: string;
  readonly detail: string;
  readonly category: "natural";
  readonly previewBackground: string;
  readonly ropeStyle: {
    readonly type: "rope" | "braided_vine" | "branch";
    readonly thickness: number;
    readonly shadowWidth: number;
    readonly highlightWidth: number;
    readonly braid?: {
      readonly amplitude: number;
      readonly pitch: number;
      readonly edgeWidth: number;
      readonly lightOffset: number;
    };
  };
  readonly clipStyle: {
    readonly type: "wood_pin";
    readonly width: number;
    readonly height: number;
    readonly offsetY: number;
    readonly previewColor: string;
    readonly accent: "none" | "leaf" | "ribbon";
    readonly tokens: Tokens;
  };
  readonly cardStyle: {
    readonly variant: "paper";
    readonly labelFont: string;
    readonly tokens: Tokens;
  };
  readonly decoration: {
    readonly type: "none" | "floral" | "wisteria" | "autumn";
    readonly spacing: number;
    readonly minGap: number;
    readonly leafSpacing: number;
    readonly cordPadding: number;
    readonly bounds: {
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
    };
  };
  readonly palette: Tokens;
  readonly physics: {
    readonly stiffness: number;
    readonly damping: number;
    readonly windResponsiveness: number;
    readonly gravitySagFactor: number;
    /** Radians; also used to size the native swept region. */
    readonly maxAngle: number;
    readonly interactionDamping: number;
    readonly windPeriod: number;
    readonly restDuration: number;
  };
}

const serif = "Georgia, 'Microsoft YaHei', serif";
const sans = "'Segoe UI', 'Microsoft YaHei', sans-serif";
const clip = {
  type: "wood_pin",
  width: 10,
  height: 31,
  offsetY: -15,
  accent: "none",
} as const;
const decoration = {
  spacing: 170,
  minGap: 48,
  leafSpacing: 46,
  cordPadding: 11,
  bounds: { left: 42, right: 42, top: 20, bottom: 42 },
} as const;
const physics = {
  stiffness: 4.5,
  damping: 2.4,
  windResponsiveness: 0.65,
  gravitySagFactor: 1,
  maxAngle: Math.PI / 90,
  interactionDamping: 12,
  windPeriod: 4,
  restDuration: 1.2,
} as const;
const branchPalette: Tokens = {
  "--rail-rope-shadow": "#44382c",
  "--rail-thread-fiber": "#d3c1a0",
  "--rail-stem": "#998468",
  "--rail-vein": "#d4d2b1",
};

export const railSkinThemes: Readonly<Record<RailSkin, RailSkinTheme>> = {
  woodland: {
    id: "woodland",
    name: "原木拾光",
    detail: "麻绳、木夹与米白纸卡",
    category: "natural",
    previewBackground: "linear-gradient(145deg, #dce2d6, #b8c9bb)",
    ropeStyle: {
      type: "rope",
      thickness: 2.4,
      shadowWidth: 4,
      highlightWidth: 0.7,
    },
    clipStyle: { ...clip, previewColor: "#cfb083", tokens: {} },
    cardStyle: { variant: "paper", labelFont: sans, tokens: {} },
    decoration: { ...decoration, type: "none" },
    palette: {
      "--rail-thread": "#c9b48c",
      "--rail-thread-fiber": "#f4e4c6",
      "--rail-rope-shadow": "#574b34",
    },
    physics,
  },
  floral: {
    id: "floral",
    name: "花间小径",
    detail: "三股花藤编织，奶油白花与柔粉花苞",
    category: "natural",
    previewBackground: "linear-gradient(145deg, #f6f0d9, #e8dfc0)",
    ropeStyle: {
      type: "braided_vine",
      thickness: 1.5,
      shadowWidth: 1,
      highlightWidth: 0.325,
      braid: {
        amplitude: 1.675,
        pitch: 42,
        edgeWidth: 2.05,
        lightOffset: 0.275,
      },
    },
    clipStyle: {
      ...clip,
      accent: "leaf",
      previewColor: "#d0bd92",
      tokens: {
        "--rail-clip-material":
          "linear-gradient(90deg, #bda77a, #e1d2ac 36%, #d0bd92 62%, #b7a078)",
        "--rail-clip-band": "#a08e67",
        "--rail-clip-sheen": "#f0e4c5",
        "--rail-clip-accent": "linear-gradient(150deg, #b3bf92, #7a976d)",
        "--rail-clip-accent-edge": "#54725866",
      },
    },
    cardStyle: {
      variant: "paper",
      labelFont: serif,
      tokens: {
        "--rail-card-material": "linear-gradient(145deg, #fffbedf7, #f3ebd3f2)",
        "--rail-card-edge": "#fffdf2",
        "--rail-card-shadow": "0 5px 10px #7765471f",
        "--rail-photo-frame": "#fcf6e3",
        "--rail-note-paper": "#f5edd7",
        "--rail-note-label": "#a08d65",
        "--rail-note-ink": "#695d44",
        "--rail-tag": "#f7f0dc",
        "--rail-tag-ink": "#60543e",
        "--rail-tag-icon": "#8b9568",
      },
    },
    decoration: { ...decoration, type: "floral", spacing: 122, minGap: 46 },
    palette: {
      "--rail-ink": "#60543e",
      "--rail-muted": "#96886a",
      "--rail-media-ink": "#8b9568",
      "--rail-braid-0": "#7c8958",
      "--rail-braid-1": "#acb57e",
      "--rail-braid-2": "#c9c29a",
      "--rail-braid-edge": "#68704899",
      "--rail-braid-light": "#eee6be",
      "--rail-vine-shadow": "#665b3c",
      "--rail-leaf": "#91a568",
      "--rail-leaf-edge": "#718251",
      "--rail-leaf-light": "#b3bd7a",
      "--rail-leaf-light-edge": "#8f9b60",
      "--rail-vein": "#e2dfaf",
      "--rail-petal": "#fffbee",
      "--rail-petal-edge": "#c7bc97",
      "--rail-flower-heart": "#d9c27d",
      "--rail-flower-heart-edge": "#b39a60",
      "--rail-pollen": "#fff2c4",
      "--rail-pink-petal": "#e9b9bb",
      "--rail-pink-edge": "#bc9397",
    },
    physics: { ...physics, windResponsiveness: 0.5 },
  },
  wisteria: {
    id: "wisteria",
    name: "紫藤轻垂",
    detail: "浅紫花穗垂落，搭配素色纸卡",
    category: "natural",
    previewBackground: "linear-gradient(145deg, #e1dfe5, #bdbecb)",
    ropeStyle: {
      type: "branch",
      thickness: 0.8,
      shadowWidth: 0.8,
      highlightWidth: 0.8,
    },
    clipStyle: {
      ...clip,
      width: 8,
      accent: "ribbon",
      previewColor: "#c9bca2",
      tokens: {
        "--rail-clip-material":
          "linear-gradient(90deg, #b6aa95, #e2d7c1 36%, #cdbfa6 62%, #b6a78c)",
        "--rail-clip-band": "#9b8f7d",
        "--rail-clip-sheen": "#ede4d5",
        "--rail-clip-accent": "#a995bb",
        "--rail-clip-accent-edge": "#77618f55",
      },
    },
    cardStyle: {
      variant: "paper",
      labelFont: serif,
      tokens: {
        "--rail-card-material": "linear-gradient(145deg, #fffdf7f5, #eeebdfef)",
        "--rail-card-edge": "#fffdf8",
        "--rail-tag": "#f3eee5",
        "--rail-tag-ink": "#56515e",
        "--rail-tag-icon": "#93859b",
        "--rail-photo-frame": "#f5f0e7",
        "--rail-note-paper": "#f1ece3",
        "--rail-note-label": "#96849b",
        "--rail-note-ink": "#605669",
      },
    },
    decoration: { ...decoration, type: "wisteria" },
    palette: {
      ...branchPalette,
      "--rail-thread": "#8c9474",
      "--rail-ink": "#56515e",
      "--rail-muted": "#8c8393",
      "--rail-media-ink": "#93859b",
      "--rail-leaf": "#8c9d72",
      "--rail-leaf-edge": "#6b805b",
      "--rail-petal-edge": "#8d78a5",
      "--rail-petal-0": "#beafd2",
      "--rail-petal-1": "#e2d7e9",
      "--rail-petal-2": "#a596bd",
      "--rail-flower-tip": "#e8dfee",
      "--rail-flower-tip-edge": "#b1a0c2",
    },
    physics: {
      ...physics,
      stiffness: 3.8,
      damping: 2.6,
      windResponsiveness: 0.48,
    },
  },
  autumn: {
    id: "autumn",
    name: "秋枝来信",
    detail: "暖棕细枝、银杏叶与小浆果",
    category: "natural",
    previewBackground: "linear-gradient(145deg, #e4d9c5, #c4b59b)",
    ropeStyle: {
      type: "branch",
      thickness: 0.8,
      shadowWidth: 0.8,
      highlightWidth: 0.8,
    },
    clipStyle: {
      ...clip,
      width: 8,
      previewColor: "#b69b71",
      tokens: {
        "--rail-clip-material":
          "linear-gradient(90deg, #a08359, #dac49c 36%, #bfa377 62%, #92744f)",
        "--rail-clip-band": "#90754e",
        "--rail-clip-sheen": "#ead8b5",
      },
    },
    cardStyle: {
      variant: "paper",
      labelFont: serif,
      tokens: {
        "--rail-card-material": "linear-gradient(145deg, #fff7e8f5, #efe3cdef)",
        "--rail-card-edge": "#fff8ed",
        "--rail-tag": "#f7eedc",
        "--rail-tag-ink": "#5a4031",
        "--rail-tag-icon": "#87694c",
        "--rail-photo-frame": "#f7eedc",
        "--rail-note-paper": "#f2e5c9",
        "--rail-note-label": "#9b7c52",
        "--rail-note-ink": "#665037",
      },
    },
    decoration: { ...decoration, type: "autumn" },
    palette: {
      ...branchPalette,
      "--rail-thread": "#8d7053",
      "--rail-ink": "#5a4031",
      "--rail-muted": "#87704f",
      "--rail-media-ink": "#87694c",
      "--rail-ginkgo": "#d0b46b",
      "--rail-ginkgo-edge": "#a98a4e",
      "--rail-ginkgo-vein": "#f1d696",
      "--rail-leaf": "#b49a69",
      "--rail-leaf-edge": "#91774b",
      "--rail-berry": "#ab7359",
      "--rail-berry-edge": "#815d46",
      "--rail-berry-light": "#e0b090",
    },
    physics: {
      ...physics,
      stiffness: 5.2,
      damping: 3,
      windResponsiveness: 0.4,
    },
  },
};

export const railSkinCatalog = railSkins.map((id) => railSkinThemes[id]);
export const getRailSkinTheme = (value: unknown) =>
  railSkinThemes[railSkin(value)];

export function railSkinStyle(theme: RailSkinTheme): CSSProperties {
  return {
    ...theme.palette,
    ...theme.clipStyle.tokens,
    ...theme.cardStyle.tokens,
    "--rail-rope-width": theme.ropeStyle.thickness,
    "--rail-rope-shadow-width": theme.ropeStyle.shadowWidth,
    "--rail-rope-highlight-width": theme.ropeStyle.highlightWidth,
    "--rail-braid-edge-width": theme.ropeStyle.braid?.edgeWidth,
    "--rail-clip-width": theme.clipStyle.width,
    "--rail-clip-height": theme.clipStyle.height,
    "--rail-clip-offset": theme.clipStyle.offsetY,
    "--rail-pin-color": theme.clipStyle.previewColor,
    "--rail-label-font": theme.cardStyle.labelFont,
    "--rail-preview-background": theme.previewBackground,
  } as CSSProperties;
}
