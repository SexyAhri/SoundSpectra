import { musicEffects, type MusicEffect } from "./music-engine/catalog";
import { normalizeSettings, type SpectrumSettings } from "./model";
import { renderVisualStudy, studyPoints, studySettings } from "./visual-study";
import "./visual-lab.css";

const root = document.querySelector<HTMLElement>("#lab")!;
root.innerHTML = `<header><small>SOUNDSPECTRA / VISUAL STUDY</small><h1>画面实验室</h1><p>合成特征序列 · 不播放、采集或代替真实音乐。固定种子、镜头和采样时钟。</p></header>
<section class="lab-controls"><label>场景<select id="effect">${musicEffects.map((e) => `<option value="${e.value}">${e.label}</option>`).join("")}</select></label>
<label>构图<select id="mode"><option value="immersive">沉浸暗场</option><option value="daily">融入桌面</option></select></label>
<label>片段<select id="point">${studyPoints.map((p) => `<option value="${p.id}">${p.label} · ${p.time}s</option>`).join("")}</select></label>
<button id="render">生成固定画面</button><button id="load">载入主区域参数</button></section>
<p id="status" role="status">请选择片段，生成画面。输入与真实音频模式独立。</p>
<div class="lab-stage"><img id="current" alt="固定输入场景画面"></div>
<section class="lab-controls"><button id="a" disabled>记为 A</button><button id="b" disabled>记为 B</button><button id="download" disabled>保存透明 PNG</button><label>对比位置<input id="split" type="range" min="0" max="100" value="50"></label></section>
<div class="lab-compare"><img id="image-a" alt="调参前 A"><div id="clip-b"><img id="image-b" alt="调参后 B"></div></div>
<p class="lab-caption">A / B 只保留在本页内存中。可在主应用调整参数后重新载入；PNG 保留透明通道。命令行批量对比会额外保存完整输入和配置。</p>`;

const select = (id: string) =>
  document.querySelector<HTMLSelectElement>(`#${id}`)!;
const button = (id: string) =>
  document.querySelector<HTMLButtonElement>(`#${id}`)!;
const picture = (id: string) =>
  document.querySelector<HTMLImageElement>(`#${id}`)!;
let loaded: SpectrumSettings | null = null,
  last = "";
async function render() {
  button("render").disabled = true;
  const effect = select("effect").value as MusicEffect,
    mode = select("mode").value as SpectrumSettings["sceneMode"];
  const config =
    loaded?.effect === effect
      ? { ...loaded, sceneMode: mode }
      : studySettings(effect, mode);
  const point = studyPoints.find((p) => p.id === select("point").value)!;
  document.querySelector("#status")!.textContent = "正在从序列起点重放…";
  const hidden = document.createElement("div");
  hidden.className = "lab-render-host";
  document.body.append(hidden);
  try {
    const report = await renderVisualStudy(hidden, config, { points: [point] });
    if (report.errors.length) throw new Error(report.errors.join("\n"));
    last = report.frames[0].image;
    picture("current").src = last;
    document.querySelector("#status")!.textContent =
      `${point.label} · ${report.output.width} × ${report.output.height} · ${report.gpu} · 输入：合成测试`;
    for (const id of ["a", "b", "download"]) button(id).disabled = false;
  } catch (error) {
    document.querySelector("#status")!.textContent = String(error);
  } finally {
    hidden.remove();
    button("render").disabled = false;
  }
}
button("render").onclick = () => void render();
button("load").onclick = () => {
  try {
    const value = JSON.parse(
      localStorage.getItem("soundspectra.settings.v1") ?? "null",
    );
    if (!value) throw new Error("请先在主应用保存参数。");
    const config = normalizeSettings(value);
    loaded = {
      ...studySettings(config.effect, config.sceneMode),
      music: config.music,
      color: config.color,
      view: config.view,
      opacity: config.opacity,
      quality: config.quality,
    };
    select("effect").value = config.effect;
    select("mode").value = config.sceneMode;
    document.querySelector("#status")!.textContent =
      "已载入主区域画面参数；点击生成固定画面。";
  } catch (error) {
    document.querySelector("#status")!.textContent = String(error);
  }
};
button("a").onclick = () => {
  picture("image-a").src = last;
};
button("b").onclick = () => {
  picture("image-b").src = last;
};
document.querySelector<HTMLInputElement>("#split")!.oninput = (event) => {
  document.querySelector<HTMLElement>("#clip-b")!.style.clipPath =
    `inset(0 ${100 - Number((event.target as HTMLInputElement).value)}% 0 0)`;
};
button("download").onclick = () => {
  const a = document.createElement("a");
  a.href = last;
  a.download = `SoundSpectra-${select("effect").value}-${select("point").value}.png`;
  a.click();
};
// The batch capture tool uses the same path and authored test sequence as this page.
Object.assign(window, {
  visualStudy: { renderVisualStudy, studySettings, studyPoints },
});
