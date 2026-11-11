import { compositions, isComposition, type CompositionId } from "./presets";
import {
  CompositionStudy,
  studySection,
  type StudyLevel,
} from "./study-session";
import "./lab.css";

const query = new URLSearchParams(location.search),
  initial = query.get("scene");
const selected = isComposition(initial) ? initial : "sculpture";
document.querySelector("#composition-lab")!.innerHTML = `
<header><div><span class="eyebrow">SOUNDSPECTRA / SPATIAL STUDIES</span><h1>三种空间，三种观看方式</h1></div><span class="input-note">无声合成特征演示<br>不播放或采集本机音乐</span></header>
<nav aria-label="构图">${Object.entries(compositions)
  .map(
    ([id, p], i) =>
      `<button data-scene="${id}" aria-pressed="${id === selected}"><small>0${i + 1} / ${p.family}</small><strong>${p.title}</strong></button>`,
  )
  .join("")}</nav>
<section class="stage" id="stage"><canvas aria-label="连续三维构图预览"></canvas><div class="reading" hidden><small>READING SPACE</small><p>让旋律经过，<br>让文字留下。</p></div><div class="stage-caption"><span id="scene-title"></span><span id="phase"></span></div></section>
<section class="controls"><button id="pause">暂停画面</button><label>显示<select id="mode"><option value="immersive">沉浸暗场</option><option value="daily">透明桌面示意</option></select></label><label>音乐力道<select id="level"><option value="sequence">24 秒连续段落</option><option value="quiet">静段</option><option value="normal">普通段</option><option value="strong">强段</option></select></label><label><input type="checkbox" id="reading">阅读避让</label><button id="fullscreen">全屏观看</button></section>
<footer><div><h2 id="family"></h2><p id="description"></p></div><div><h2>音乐如何改变它</h2><p id="mapping"></p><p class="fine">静段有克制的连续流动。此页独立于正式效果配置。</p></div></footer><p id="error" role="status"></p>`;
const canvas = document.querySelector("canvas")!,
  session = new CompositionStudy(canvas, selected);
const element = (id: string) => document.getElementById(id)!;
const mode = element("mode") as HTMLSelectElement;
let paused = false,
  last = 0,
  raf = 0,
  resizePending = false;
function describe(id: CompositionId) {
  const p = compositions[id];
  element("scene-title").textContent = `${p.family} / ${p.title}`;
  element("family").textContent = p.title;
  element("description").textContent = p.description;
  element("mapping").textContent = p.mapping;
  document
    .querySelectorAll<HTMLButtonElement>("[data-scene]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.scene === id)),
    );
}
describe(selected);
document.querySelectorAll<HTMLButtonElement>("[data-scene]").forEach(
  (b) =>
    (b.onclick = () => {
      const id = b.dataset.scene as CompositionId;
      void session.select(id).then(() => {
        if (paused) session.step(0);
      });
      describe(id);
      const url = new URL(location.href);
      url.searchParams.set("scene", id);
      history.replaceState(null, "", url);
    }),
);
mode.onchange = () => {
  session.settings.sceneMode = mode.value as "daily" | "immersive";
  element("stage").classList.toggle("daily", mode.value === "daily");
  if (paused) session.step(0);
};
(element("level") as HTMLSelectElement).onchange = (e) => {
  session.level = (e.target as HTMLSelectElement).value as StudyLevel;
};
(element("reading") as HTMLInputElement).onchange = (e) => {
  session.reading = (e.target as HTMLInputElement).checked;
  (document.querySelector(".reading") as HTMLElement).hidden = !session.reading;
  if (paused) session.step(0);
};
element("pause").onclick = () => {
  paused = !paused;
  element("pause").textContent = paused ? "继续画面" : "暂停画面";
  last = 0;
};
element("fullscreen").onclick = () => {
  void (document.fullscreenElement
    ? document.exitFullscreen()
    : element("stage").requestFullscreen());
};
const observer = new ResizeObserver(() => {
  resizePending = true;
});
observer.observe(canvas);
await session.resize();
function tick(now: number) {
  if (resizePending) {
    resizePending = false;
    void session.resize();
  }
  if (!paused && !document.hidden) {
    session.step(last ? Math.min((now - last) / 1000, 0.05) : 1 / 60);
  }
  last = now;
  element("phase").textContent =
    `${session.level === "sequence" ? studySection(session.time) : { quiet: "静段", normal: "普通段", strong: "强段" }[session.level]} · ${session.time.toFixed(1)}s`;
  if (session.errors.length)
    element("error").textContent = session.errors.join("\n");
  raf = requestAnimationFrame(tick);
}
raf = requestAnimationFrame(tick);
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    session.dispose();
  },
  { once: true },
);
