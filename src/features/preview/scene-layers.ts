import { MAX_REGIONS, type SpectrumSettings } from "../spectrum/model";
import { regionStyle, sceneRegions } from "../spectrum/regions";

export type LayerMove = "front" | "back" | "up" | "down";
export function sceneLayers(settings: SpectrumSettings) {
  const fallback = [
    ...sceneRegions(settings).map((region) => `effect:${region.id}`),
    "lyrics",
    "card",
  ];
  const preferred = (settings.layerOrder ?? []).filter((id) =>
    fallback.includes(id),
  );
  return [...new Set([...preferred, ...fallback])];
}
export const layerIndex = (settings: SpectrumSettings, id: string) =>
  2 + sceneLayers(settings).indexOf(id);
export function moveLayer(
  settings: SpectrumSettings,
  id: string,
  move: LayerMove,
): Partial<SpectrumSettings> {
  const order = sceneLayers(settings),
    from = order.indexOf(id);
  if (from < 0) return {};
  const to =
    move === "front"
      ? order.length - 1
      : move === "back"
        ? 0
        : Math.max(
            0,
            Math.min(order.length - 1, from + (move === "up" ? 1 : -1)),
          );
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { layerOrder: order };
}
export function duplicateRegion(
  settings: SpectrumSettings,
  id: string,
  nextId: string,
): Partial<SpectrumSettings> {
  const region = sceneRegions(settings).find((item) => item.id === id);
  if (!region || settings.regions.length >= MAX_REGIONS - 1) return {};
  const bounds = {
    ...region.bounds,
    x: Math.min(1 - region.bounds.width, region.bounds.x + 0.025),
    y: Math.min(1 - region.bounds.height, region.bounds.y + 0.025),
  };
  const order = sceneLayers(settings);
  order.splice(order.indexOf(`effect:${id}`) + 1, 0, `effect:${nextId}`);
  return {
    regions: [
      ...settings.regions,
      {
        ...structuredClone(region),
        id: nextId,
        name: `${region.name.slice(0, 20)} 副本`,
        bounds,
      },
    ],
    layerOrder: order,
  };
}
export function removeRegion(
  settings: SpectrumSettings,
  id: string,
): Partial<SpectrumSettings> {
  if (!settings.regions.length) return {};
  const order = sceneLayers(settings).filter((key) => key !== `effect:${id}`);
  if (id !== "primary")
    return {
      regions: settings.regions.filter((region) => region.id !== id),
      layerOrder: order,
    };
  const [promoted, ...regions] = settings.regions;
  return {
    ...regionStyle(promoted),
    regionName: promoted.name,
    regionVisible: promoted.visible,
    regions,
    layerOrder: order.map((key) =>
      key === `effect:${promoted.id}` ? "effect:primary" : key,
    ),
  };
}
