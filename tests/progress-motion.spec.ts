import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await page.emulateMedia({ reducedMotion });
  await page.route("**/src/main.tsx*", route => route.fulfill({
    contentType: "text/javascript",
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import ReactDOMSync from '/node_modules/.vite/deps/react-dom.js';
      import { MusicProgress } from '/src/features/music/music-progress.tsx';
      import { TooltipProvider } from '/src/components/ui/tooltip.tsx';
      import { emptySnapshot } from '/src/features/music/types.ts';
      import '/src/index.css';
      import '/src/features/music/music.css';
      window.commands=[];
      const initial={...emptySnapshot.playback,generation:1,seekRevision:1,index:0,
        queue:[{id:'demo',title:'示例'}],position:12,duration:180,playing:false,phase:'paused'};
      function App(){
        const [p,setP]=React.useState(initial);
        window.update=p=>ReactDOMSync.flushSync(()=>setP(old=>({...old,...p})));
        return React.createElement('div',{className:'studio-shell',style:{width:900,padding:30}},
          React.createElement(MusicProgress,{playback:p,command:(action,value)=>window.commands.push({action,value})}));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TooltipProvider, null, React.createElement(App)));
    `,
  }));
  await page.goto("/");
  await expect(page.getByRole("slider", { name: "播放进度" })).toHaveValue("12");
}

for (const preference of ["no-preference", "reduce"] as const) test(`playback progress advances, freezes when stale, and seeks immediately (${preference})`, async ({ page }) => {
  await fixture(page, preference);
  const samples = await page.evaluate(async () => {
    (window as any).update({ playing: true, phase: "playing" });
    const values: number[] = [];
    const slider = document.querySelector<HTMLInputElement>('input[type=range]')!;
    const fill = document.querySelector<HTMLElement>(".library-progress-played")!;
    const started = performance.now();
    while (performance.now() - started < 350) {
      await new Promise(requestAnimationFrame);
      values.push(Number(slider.value));
      if (Math.abs(parseFloat(fill.style.width) * 180 / 100 - Number(slider.value)) > .011)
        throw Error("thumb and fill diverged");
    }
    return values;
  });
  expect(new Set(samples).size).toBeGreaterThan(5);
  expect(samples.at(-1)!).toBeGreaterThan(12.2);
  expect(samples.every((value, i) => !i || value >= samples[i - 1])).toBe(true);
  const slider = page.getByRole("slider", { name: "播放进度" });
  await expect(slider).toHaveValue("12.9");
  await page.waitForTimeout(250);
  await expect(slider).toHaveValue("12.9");
  await page.evaluate(() => (window as any).update({ playing: false, phase: "paused", position: 12.4 }));
  await expect(slider).toHaveValue("12.4");
  await slider.press("End");
  await expect(slider).toHaveValue("180");
  expect(await page.evaluate(() => (window as any).commands.at(-1))).toEqual({ action: "seek", value: 180 });
  await page.waitForTimeout(200);
  await expect(slider).toHaveValue("180");
  await page.evaluate(() => (window as any).update({ seekRevision: 2, position: 180 }));
  await expect(slider).toHaveValue("180");
  await page.evaluate(() => (window as any).update({ generation: 2, position: 3 }));
  await expect(slider).toHaveValue("3");
});

test("download and playback remain smooth after the system motion preference changes", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).update({ transfer: { status: "downloading", received: 20, total: 100 } }));
  const download = page.getByRole("progressbar", { name: "音频下载进度" });
  const ratio = () => download.evaluate(n => n.getBoundingClientRect().width / n.parentElement!.getBoundingClientRect().width);
  await expect.poll(ratio).toBeCloseTo(.2, 2);
  const middle = await page.evaluate(async () => {
    (window as any).update({ transfer: { status: "downloading", received: 80, total: 100 } });
    await new Promise(resolve => setTimeout(resolve, 120));
    const node = document.querySelector(".library-progress-download")!;
    return node.getBoundingClientRect().width / node.parentElement!.getBoundingClientRect().width;
  });
  expect(middle).toBeGreaterThan(.2);
  expect(middle).toBeLessThan(.8);
  await expect.poll(ratio).toBeCloseTo(.8, 2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMiddle = await page.evaluate(async () => {
    (window as any).update({ playing: true, phase: "playing", position: 30, transfer: { status: "downloading", received: 95, total: 100 } });
    await new Promise(resolve => setTimeout(resolve, 120));
    const node = document.querySelector(".library-progress-download")!;
    return node.getBoundingClientRect().width / node.parentElement!.getBoundingClientRect().width;
  });
  expect(reducedMiddle).toBeGreaterThan(.8);
  expect(reducedMiddle).toBeLessThan(.95);
  await expect.poll(ratio).toBeCloseTo(.95, 2);
  await page.waitForTimeout(300);
  expect(Number(await page.getByRole("slider", { name: "播放进度" }).inputValue())).toBeGreaterThan(30.2);
});
