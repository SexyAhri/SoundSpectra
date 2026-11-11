/** Keep live diagnostics current without invalidating DOM for unchanged values. */
export function sceneData(canvas: HTMLCanvasElement, key: string, value: string) {
  if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
}
