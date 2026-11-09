import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type WallpaperPosition =
  | "center"
  | "tile"
  | "stretch"
  | "fit"
  | "fill"
  | "span";
export interface DesktopBackground {
  screen: ScreenRect;
  virtualScreen: ScreenRect;
  position: WallpaperPosition;
  color: string;
  image: string | null;
  revision: string;
  issue: string | null;
  anchor?: { x: number; y: number };
}
export interface PreviewImage {
  url: string;
  width: number;
  height: number;
}
export const referenceScreen: ScreenRect = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};
export const loadDesktopBackground = (knownRevision?: string) =>
  invoke<DesktopBackground>("get_desktop_background", {
    knownRevision: knownRevision ?? null,
  });

export async function decodePreview(url: string): Promise<PreviewImage> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error("无法解码这张图片，请选择 PNG、JPEG、WebP 或 BMP 图片。");
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width * height > 100_000_000)
    throw new Error("图片尺寸过大，请选择较小的参考图片。");
  const scale = Math.min(1, 1920 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法生成壁纸预览。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const preview = { url: canvas.toDataURL("image/webp", 0.94), width, height };
  canvas.width = canvas.height = 1;
  return preview;
}

export async function readReference(file: File) {
  if (!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(file.type))
    throw new Error("请选择 PNG、JPEG、WebP 或 BMP 图片。");
  if (file.size > 32 * 1024 * 1024)
    throw new Error("图片超过 32 MB，请选择较小的文件。");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
  return decodePreview(url);
}

// Keep the thumbnail in IndexedDB, outside the small localStorage settings budget.
export async function referenceImage(
  value?: PreviewImage,
): Promise<PreviewImage | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("soundspectra-preview", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        "images",
        value ? "readwrite" : "readonly",
      );
      const store = transaction.objectStore("images");
      const request = value
        ? store.put(value, "reference")
        : store.get("reference");
      transaction.oncomplete = () => resolve(value ?? request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error("无法保存参考图片"));
    });
  } finally {
    db.close();
  }
}

// Preview and palette sampling must see the same crop, bars and spanning offset.
export function wallpaperPlacement(
  image: PreviewImage,
  desktop: DesktopBackground | null,
  screen: ScreenRect,
) {
  const position = desktop?.position ?? "fill";
  const target = position === "span" ? desktop!.virtualScreen : screen;
  let width = image.width,
    height = image.height;
  if (position === "stretch") {
    width = target.width;
    height = target.height;
  } else if (position === "fit" || position === "fill" || position === "span") {
    const ratio = (position === "fit" ? Math.min : Math.max)(
      target.width / width,
      target.height / height,
    );
    width *= ratio;
    height *= ratio;
  }
  const x =
    position === "tile"
      ? 0
      : (target.width - width) * (desktop?.anchor?.x ?? 0.5) +
        target.x -
        screen.x;
  const y =
    position === "tile"
      ? 0
      : (target.height - height) * (desktop?.anchor?.y ?? 0.5) +
        target.y -
        screen.y;
  return { x, y, width, height, tile: position === "tile" };
}

export function wallpaperStyle(
  image: PreviewImage | null,
  desktop: DesktopBackground | null,
  screen: ScreenRect,
  previewWidth: number,
): CSSProperties {
  if (!image) return { backgroundColor: desktop?.color ?? "#25232c" };
  const { x, y, width, height, tile } = wallpaperPlacement(
    image,
    desktop,
    screen,
  );
  const scale = previewWidth / screen.width;
  return {
    backgroundColor: desktop?.color ?? "#25232c",
    backgroundImage: `url("${image.url}")`,
    backgroundSize: `${width * scale}px ${height * scale}px`,
    backgroundPosition: `${x * scale}px ${y * scale}px`,
    backgroundRepeat: tile ? "repeat" : "no-repeat",
  };
}
