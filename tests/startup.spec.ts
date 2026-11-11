import { expect, test, type Page } from "@playwright/test";
import { fulfillFixtureEntry } from "./helpers/fixture-entry";
import { defaults } from "../src/features/spectrum/model";
import { railDefaults } from "../src/features/rail/model";

const epoch = new Date("2026-11-11T00:00:00Z");

async function freezeClock(page: Page) {
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
}

async function fixture(page: Page, ready = false) {
  await freezeClock(page);
  await page.route("**/src/main.tsx*", route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { StartupScreen, useStartupScreen } from '/src/features/application/startup-screen.tsx';
    import '/src/index.css';
    function App() {
      const [ready, setReady] = React.useState(${ready});
      window.startupReady = setReady;
      const startup = useStartupScreen(ready);
      return React.createElement(React.Fragment, null,
        startup.phase !== 'done' && React.createElement(StartupScreen, { phase: startup.phase, ready, onSkip: startup.skip }),
        React.createElement('main', { inert: startup.phase !== 'done' }, React.createElement('button', null, '工作台已就绪')));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(App)));
  `));
  await page.goto("/");
  await expect(page.locator(".startup-screen")).toBeVisible();
}

test("intro completes before revealing ready content and a late reply cannot reopen it", async ({ page }) => {
  await fixture(page, true);
  const screen = page.locator(".startup-screen");
  await page.clock.fastForward(3999);
  await expect(screen).toHaveAttribute("data-phase", "intro");
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
  await page.clock.fastForward(1);
  await expect(screen).toHaveAttribute("data-phase", "leaving");
  await page.clock.fastForward(600);
  await expect(screen).toHaveCount(0);
  await expect(page.locator("main")).toHaveJSProperty("inert", false);
  await page.evaluate(() => (window as any).startupReady(false));
  await page.clock.fastForward(10000);
  await page.evaluate(() => (window as any).startupReady(true));
  await expect(screen).toHaveCount(0);
});

test("initialization waits after the intro and times out without trapping the workspace", async ({ page }) => {
  await fixture(page);
  await page.clock.fastForward(7999);
  await expect(page.getByRole("status")).toHaveText("正在准备工作台…");
  await expect(page.locator(".startup-screen")).toHaveAttribute("data-phase", "intro");
  await page.clock.fastForward(1);
  await expect(page.locator(".startup-screen")).toHaveAttribute("data-phase", "leaving");
  await page.clock.fastForward(600);
  await expect(page.locator("main")).toHaveJSProperty("inert", false);
});

test("initialization finishing after the intro releases the workspace", async ({ page }) => {
  await fixture(page);
  await page.clock.fastForward(4400);
  await page.evaluate(() => (window as any).startupReady(true));
  await expect(page.locator(".startup-screen")).toHaveAttribute("data-phase", "leaving");
  await page.clock.fastForward(600);
  await expect(page.locator(".startup-screen")).toHaveCount(0);
});

test("keyboard skip releases interaction immediately and pending timers stay cleared", async ({ page }) => {
  await fixture(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /跳过动画/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".startup-screen")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "工作台已就绪" })).toBeEnabled();
  await page.clock.fastForward(10000);
  await expect(page.locator(".startup-screen")).toHaveCount(0);
});

test("sound waves change pixels during the opening, gathering and settled mark", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  const canvas = page.locator(".startup-field");
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
    let hash = 0, visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2] + data[i + 3]) | 0;
      if (data[i + 3] > 20) visible++;
    }
    return { hash, visible };
  });
  const frames = [];
  for (const duration of [800, 1000, 1700, 400]) {
    await page.clock.fastForward(duration);
    frames.push(await pixels());
  }
  expect(new Set(frames.map(frame => frame.hash)).size).toBe(4);
  expect(frames.every(frame => frame.visible > 1000)).toBe(true);
  await page.getByRole("button", { name: /跳过动画/ }).click();
  await expect(canvas).toHaveCount(0);
});

for (const exit of ["fade", "skip"] as const) {
  test(`covered scene and rail stop work, then resume on startup ${exit}`, async ({ page }) => {
    await page.addInitScript(({ settings, rail }) => {
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
      localStorage.setItem("soundspectra.rail.v1", JSON.stringify(rail));
    }, {
      settings: { ...defaults, effect: "aurora_flow", quality: "eco", regionVisible: true },
      rail: { ...railDefaults, enabled: true, groups: [{ ...railDefaults.groups[0], items: [
        { id: "startup-note", name: "开场检查", kind: "note", path: "", text: "保持摇摆效果", crop: "cover" },
      ] }] },
    });
    await freezeClock(page);
    await page.goto("/");
    const scene = page.locator(".desktop-preview .three-scene-surface canvas");
    const rail = page.locator(".desktop-preview .rail-surface");
    // Let the preview's layout and lazy renderer commit under the paused clock.
    await expect.poll(async () => {
      await page.clock.runFor(50);
      return scene.count();
    }).toBe(1);
    await expect(rail).toHaveCount(1);
    await page.clock.fastForward(100);
    await expect(scene).toHaveAttribute("data-occluded", "true");
    await expect(rail).toHaveAttribute("data-breeze-active", "false");
    const frames = await scene.getAttribute("data-frames");
    await page.clock.fastForward(1000);
    expect(await scene.getAttribute("data-frames")).toBe(frames);
    if (exit === "skip") await page.getByRole("button", { name: /跳过动画/ }).click();
    else {
      const elapsed = await page.evaluate(() => Date.now());
      await page.clock.fastForward(epoch.getTime() + 4000 - elapsed);
      await expect(page.locator(".startup-screen")).toHaveAttribute("data-phase", "leaving");
    }
    await page.clock.resume();
    await expect(scene).toHaveAttribute("data-occluded", "false");
    await expect(rail).toHaveAttribute("data-breeze-active", "true");
    await expect.poll(async () => Number(await scene.getAttribute("data-frames"))).toBeGreaterThan(Number(frames));
    await expect(page.locator(".startup-screen")).toHaveCount(0);
    await expect(page.locator(".render-error")).toHaveCount(0);
  });
}

for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[1280, 840], [390, 700], [640, 360]]) {
    test(`main startup is animated and fits ${theme} ${width}x${height} under the system reduce preference`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(theme => localStorage.setItem("soundspectra.theme", theme), theme);
      await freezeClock(page);
      await page.goto("/");
      const screen = page.getByRole("region", { name: "SoundSpectra 启动动画" });
      await expect(screen).toBeVisible();
      await expect(page.locator(".studio-shell")).toHaveJSProperty("inert", true);
      await expect(page.locator(".startup-spectrum > span").first()).toHaveCSS("animation-iteration-count", "infinite");
      await page.clock.fastForward(3400);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.querySelector(".startup-screen")!.getAnimations({ subtree: true }).forEach(animation => {
          animation.pause();
          animation.currentTime = 3400;
        });
      });
      const fit = await screen.evaluate(node => {
        const inside = (child: Element) => {
          const b = child.getBoundingClientRect();
          return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight;
        };
        return [...node.querySelectorAll(".startup-name, .startup-tagline, .startup-footer button")].every(inside)
          && document.documentElement.scrollWidth === innerWidth;
      });
      expect(fit).toBe(true);
      await page.screenshot({ path: `artifacts/startup/${theme}-${width}x${height}.png` });
      await page.getByRole("button", { name: /跳过动画/ }).click();
      await expect(page.locator(".studio-shell")).toHaveJSProperty("inert", false);
    });
  }
}

test("settings load errors remain accessible after the startup layer leaves", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("soundspectra.settings.v1", "{invalid"));
  await page.goto("/");
  await expect(page.locator(".startup-screen")).toBeVisible();
  await expect(page.locator(".startup-screen")).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(".studio-shell")).toHaveJSProperty("inert", false);
  await expect(page.getByRole("alert").first()).toBeVisible();
});

for (const windowKind of ["overlay", "rail", "rail-popup", "card-controls", "music-player"]) {
  test(`${windowKind} window does not mount a startup screen`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string) => command === "plugin:event|listen" ? 1 : null,
        transformCallback: () => 1,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    });
    await page.goto(`/?window=${windowKind}`);
    await page.waitForFunction(() => Object.keys(document.getElementById("root")!).some(key => key.startsWith("__reactContainer$")));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator(".studio-shell")).toHaveCount(0);
    await expect(page.locator(".startup-screen")).toHaveCount(0);
  });
}
