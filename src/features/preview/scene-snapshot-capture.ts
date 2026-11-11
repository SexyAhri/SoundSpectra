import { toSvg } from "html-to-image";
import type { SpectrumSettings } from "../spectrum/model";
import { refreshCanvasSnapshot } from "../spectrum/canvas-snapshot";
import { sceneRegions } from "../spectrum/regions";

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function waitForScene(
  container: HTMLElement,
  settings: SpectrumSettings,
  signal: AbortSignal,
) {
  // Allow React and the renderer effects to consume the frozen capture settings.
  await nextFrame();
  await nextFrame();
  while (!signal.aborted && container.isConnected) {
    const surface = container.querySelector<HTMLElement>(
      ".desktop-preview[data-ready=true]",
    );
    const effects = sceneRegions(settings).filter((region) => region.visible);
    const ready =
      surface &&
      !surface.querySelector("[role=alert]") &&
      effects.every((region) => {
        const canvas = surface.querySelector<HTMLCanvasElement>(
          `[data-region-id="${CSS.escape(region.id)}"] canvas`,
        );
        if (canvas) {
          try {
            refreshCanvasSnapshot(canvas);
          } catch {
            return false;
          }
        }
        return (
          canvas?.dataset.scene === region.effect &&
          Number(canvas.dataset.frames) > 0 &&
          canvas.dataset.transition === "idle" &&
          canvas.dataset.resizePaused !== "true"
        );
      });
    const lyrics = surface?.querySelector<HTMLCanvasElement>(
      ".kinetic-lyrics-canvas",
    );
    const images = surface && Array.from(surface.querySelectorAll("img"));
    if (
      ready &&
      (!lyrics || lyrics.dataset.fontsReady === "true") &&
      images?.every((image) => image.complete && image.naturalWidth > 0)
    )
      return surface;
    await nextFrame();
  }
  throw new Error("场景预览尚未准备好");
}

// Embed only font shards already used by the app, rather than fetching every
// Chinese character range in the bundled typefaces for a small thumbnail.
async function loadedFontCSS(signal: AbortSignal) {
  const normalize = (value: string) =>
    value.replace(/[\s"']/g, "").toLowerCase();
  const loaded = Array.from(document.fonts).filter(
    (font) => font.status === "loaded",
  );
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (
          rule instanceof CSSFontFaceRule &&
          loaded.some(
            (font) =>
              normalize(font.family) === normalize(rule.style.fontFamily) &&
              normalize(font.unicodeRange) ===
                normalize(
                  rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF",
                ),
          )
        )
          rules.push(rule);
      }
    } catch {
      /* Unreadable external sheets do not supply application fonts. */
    }
  }
  return (
    await Promise.all(
      rules.map(async (rule) => {
        let css = rule.cssText;
        for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const url = new URL(
            match[1],
            rule.parentStyleSheet?.href ?? location.href,
          );
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error("字体读取失败");
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            void response
              .blob()
              .then((blob) => reader.readAsDataURL(blob), reject);
          });
          css = css.replace(match[0], `url("${data}")`);
        }
        return css;
      }),
    )
  ).join("\n");
}

export async function captureSceneSnapshot(
  container: HTMLElement,
  settings: SpectrumSettings,
): Promise<Blob> {
  const controller = new AbortController();
  let timer = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      controller.abort();
      reject(new Error("缩略图生成超时"));
    }, 8000);
  });
  const capture = async () => {
    const surface = await waitForScene(container, settings, controller.signal);
    await document.fonts.ready;
    const fontEmbedCSS = await loadedFontCSS(controller.signal);
    const width = surface.clientWidth,
      height = surface.clientHeight;
    const scale = Math.min(640 / width, 360 / height);
    const svg = await toSvg(surface, {
      fontEmbedCSS,
      fetchRequestInit: { signal: controller.signal },
      style: { borderRadius: "0", boxShadow: "none" },
      filter: (node) => {
        if (controller.signal.aborted) throw new Error("缩略图生成已取消");
        if (
          node.matches?.(".preview-corner,.lyric-demo-label,.region-edit-label")
        )
          return false;
        if (node instanceof HTMLCanvasElement) refreshCanvasSnapshot(node);
        return true;
      },
    });
    // Renderer/lyric diagnostic keys may contain unit separators. They are valid
    // DOM attribute values but cannot be decoded as XML inside an SVG image.
    const xml = decodeURIComponent(svg.slice(svg.indexOf(",") + 1)).replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,
      "",
    );
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法生成缩略图");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("缩略图生成失败")),
          "image/webp",
          0.88,
        ),
      );
    } finally {
      canvas.width = canvas.height = 1;
    }
  };
  try {
    return await Promise.race([capture(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
