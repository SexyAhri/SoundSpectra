import { test, expect, type Page } from "@playwright/test";

async function fadedPlayerFixture(page: Page) {
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicPlayer } from '/src/features/music/music-player.tsx';
    window.playerState={generation:1,revision:1,seekRevision:1,ready:true,playing:true,position:42,volume:.8,streamUrl:'http://127.0.0.1:12345/first'};
    window.audioEvents=[];window.feedback=[];
    window.Audio=class {
      constructor(){window.testAudio=this;this.readyState=4;this.currentTime=0;this.duration=180;this.paused=true;this.ended=false;this.level=0;this.listeners={}}
      set volume(value){this.level=value;window.audioEvents.push({kind:'volume',value,time:performance.now()})}
      get volume(){return this.level}
      set src(value){this.url=value;this.readyState=4;this.paused=true;this.currentTime=0;window.audioEvents.push({kind:'src',value,volume:this.volume,time:performance.now()})}
      get src(){return this.url}
      addEventListener(name,handler){this.listeners[name]=handler}
      removeEventListener(name){delete this.listeners[name]}
      load(){}
      removeAttribute(){this.url='';this.readyState=0}
      pause(){this.paused=true;window.audioEvents.push({kind:'pause',volume:this.volume,time:performance.now()})}
      async play(){this.paused=false;this.listeners.playing?.()}
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={transformCallback:handler=>{window.wake=handler;return 1},invoke:async(command,args)=>{if(command==='music_player_state')return structuredClone(window.playerState);if(command==='music_player_feedback')window.feedback.push(args.feedback);return 1}};
    window.changePlayer=changes=>{Object.assign(window.playerState,changes);window.playerState.revision++;window.wake({payload:null})};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicPlayer));
  `,
    }),
  );
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio?.volume))
    .toBe(0.8);
}

async function fixture(page: Page, loggedIn = true) {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicLibrary } from '/src/features/music/music-library.tsx';
    import { emptySnapshot } from '/src/features/music/types.ts';
    import '/src/index.css';
    window.commands=[]; window.offsets=[]; window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      window.commands.push({command,args});
      if(command==='music_snapshot')return structuredClone(window.musicState);
      if(command==='music_login'){
        if(args.action==='cancel' && window.rejectLoginCancel)throw new Error('取消登录失败');
        window.musicState.login=args.action==='cancel'?{phase:'',qr:null,message:''}:{provider:args.provider,phase:'waiting',qr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',message:args.provider==='netease'?'使用手机网易云音乐扫码并确认登录':'使用手机 QQ 扫码'};
        return;
      }
      if(command==='music_playlists')return {items:[{id:'1',name:'示例歌单',cover:null,count:201}],total:1,nextOffset:null,filtered:0};
      if(command==='music_tracks'){
        window.offsets.push(args.offset);
        return {items:[{id:'song'+args.offset,provider:'qq',title:'歌曲'+args.offset,artist:'示例歌手',album:'示例专辑',cover:null,duration:180,paid:false}],total:201,nextOffset:args.offset<200?args.offset+100:null,filtered:args.offset===100?1:0};
      }
      if(command==='music_search')return {items:[{id:'result'+args.offset,provider:'qq',title:args.query+' (Live)',artist:'歌手',album:'专辑',duration:180,cover:null,paid:true}],total:31,nextOffset:args.offset===0?30:null,filtered:0};
      if(command==='music_preferences'){window.prefs=args.preferences??window.prefs??{lyricMib:32,normalize:false};return window.prefs;}
      if(command==='music_cache')return {audioBytes:0,lyricBytes:20,metadataBytes:100,limitBytes:33554432,pending:args.clear?1:0};
      if(command==='music_browse'){window.browse=args.value??window.browse??null;return window.browse;}
      if(command==='music_library_data')return window.localIndex??{items:[],total:0,synced:0,complete:false,updated:0,nextOffset:0};
      if(command==='music_offset'){window.musicState.playback.lyricOffset=args.value;return args.value;}
      if(command==='music_play')return;
      if(command==='music_lyrics')return window.musicLyrics;
      return null;
    }};
    window.musicState=structuredClone(emptySnapshot);
    window.musicState.providers=[{id:"qq",name:"QQ 音乐",capabilities:["qr-login","search","playlists","playback","lyrics"]}];
    if(${loggedIn})window.musicState.account={provider:'qq',nickname:'示例账号',avatar:null,membership:{active:true,name:'SVIP',level:8,expires:'2099-01-01 00:00:00'},membershipIssue:null};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',{className:'studio-shell',style:{height:'100dvh',display:'flex'}},React.createElement(MusicLibrary)));
  `,
    }),
  );
  await page.goto("/#music");
}

test("player fades pause and resume, reverses a pending pause and keeps zero volume silent", async ({
  page,
}) => {
  await fadedPlayerFixture(page);
  const midPause = await page.evaluate(async () => {
    const w = window as any;
    w.audioEvents = [];
    w.fadeStarted = performance.now();
    w.changePlayer({ playing: false });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { volume: w.testAudio.volume, paused: w.testAudio.paused };
  });
  expect(midPause.volume).toBeGreaterThan(0);
  expect(midPause.volume).toBeLessThan(0.8);
  expect(midPause.paused).toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.paused))
    .toBe(true);
  const paused = await page.evaluate(() => {
    const w = window as any;
    const event = w.audioEvents.find((e: any) => e.kind === "pause");
    return { delay: event.time - w.fadeStarted, volume: event.volume };
  });
  expect(paused.delay).toBeGreaterThanOrEqual(180);
  expect(paused.volume).toBe(0);
  const midResume = await page.evaluate(async () => {
    const w = window as any;
    w.changePlayer({ playing: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { volume: w.testAudio.volume, paused: w.testAudio.paused };
  });
  expect(midResume.volume).toBeGreaterThan(0);
  expect(midResume.volume).toBeLessThan(0.8);
  expect(midResume.paused).toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0.8);
  const reversal = await page.evaluate(async () => {
    const w = window as any;
    w.audioEvents = [];
    w.changePlayer({ playing: false });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const before = w.testAudio.volume;
    w.changePlayer({ playing: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, after: w.testAudio.volume };
  });
  expect(reversal.after).toBeGreaterThan(reversal.before);
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0.8);
  expect(
    await page.evaluate(() =>
      (window as any).audioEvents.some((e: any) => e.kind === "pause"),
    ),
  ).toBe(false);
  await page.evaluate(() => (window as any).changePlayer({ volume: 0 }));
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0);
  await page.evaluate(() => (window as any).changePlayer({ playing: false }));
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.paused))
    .toBe(true);
});

test("rapid track changes fade the old source before starting only the latest track", async ({
  page,
}) => {
  await fadedPlayerFixture(page);
  const during = await page.evaluate(async () => {
    const w = window as any;
    w.audioEvents = [];
    w.feedback = [];
    w.changePlayer({
      generation: 2,
      ready: false,
      playing: false,
      position: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    w.changePlayer({
      generation: 3,
      seekRevision: 3,
      ready: true,
      playing: true,
      position: 5,
      streamUrl: "http://127.0.0.1:12345/third",
    });
    return {
      source: w.testAudio.src,
      volume: w.testAudio.volume,
      paused: w.testAudio.paused,
    };
  });
  expect(during.source).toBe("http://127.0.0.1:12345/first");
  expect(during.volume).toBeGreaterThan(0);
  expect(during.volume).toBeLessThan(0.8);
  expect(during.paused).toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.src))
    .toBe("http://127.0.0.1:12345/third");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0.8);
  const result = await page.evaluate(() => {
    const w = window as any;
    return {
      switches: w.audioEvents.filter((e: any) => e.kind === "src"),
      pauses: w.audioEvents.filter((e: any) => e.kind === "pause"),
      feedback: w.feedback,
    };
  });
  expect(result.switches.map((e: any) => e.value)).toEqual([
    "http://127.0.0.1:12345/third",
  ]);
  expect(result.switches[0].volume).toBe(0);
  expect(result.pauses.every((e: any) => e.volume === 0)).toBe(true);
  expect(
    result.feedback
      .filter((f: any) => f.generation === 3)
      .every((f: any) => f.position === 5),
  ).toBe(true);
  await page.evaluate(() =>
    (window as any).changePlayer({
      generation: 4,
      ready: false,
      playing: false,
    }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.src))
    .toBe("");
  expect(await page.evaluate(() => (window as any).testAudio.paused)).toBe(
    true,
  );
});

test("a track change during pause fade completes the switch and honours a later pause", async ({
  page,
}) => {
  await fadedPlayerFixture(page);
  await page.evaluate(async () => {
    const w = window as any;
    w.changePlayer({ playing: false });
    await new Promise((resolve) => setTimeout(resolve, 70));
    w.changePlayer({
      generation: 2,
      seekRevision: 2,
      position: 0,
      playing: true,
      streamUrl: "http://127.0.0.1:12345/second",
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.src))
    .toBe("http://127.0.0.1:12345/second");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0.8);
  await page.evaluate(async () => {
    const w = window as any;
    w.changePlayer({
      generation: 3,
      seekRevision: 3,
      position: 0,
      playing: true,
      streamUrl: "http://127.0.0.1:12345/third",
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    w.changePlayer({ playing: false });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.src))
    .toBe("http://127.0.0.1:12345/third");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.paused))
    .toBe(true);
  expect(await page.evaluate(() => (window as any).testAudio.volume)).toBe(0);
});

test("music library uses the existing workspace and honestly disables browser login", async ({
  page,
}) => {
  await page.goto("/#music");
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .or(page.getByRole("complementary", { name: "主导航" })),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "音乐库", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("请在桌面版连接音乐账号")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "获取登录二维码" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "桌面与性能", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "显示到桌面", exact: false })
      .or(page.getByText("显示到桌面", { exact: true })),
  ).toBeVisible();
});

test("filtered songs preserve server offsets and the loaded queue", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.getByText("SVIP8", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "我喜欢", exact: true }).click();
  await expect(
    page.getByText("已加载 1 / 201 首", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加载全部", exact: true }).click();
  await expect(
    page.getByText("已加载 3 / 201 首 · 1 首不可用", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).offsets)).toEqual([
    0, 100, 200,
  ]);
  await page.getByRole("button", { name: "播放已加载歌曲" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).commands.find((r: any) => r.command === "music_play")
          .args,
    ),
  ).toEqual({ ids: ["qq:song0", "qq:song100", "qq:song200"], index: 0 });
  await page.getByRole("button", { name: "返回歌单" }).click();
  await expect(
    page.getByRole("button", { name: "示例歌单 201 首" }),
  ).toBeVisible();
});

test("QR login stays inside the library and can refresh and cancel", async ({
  page,
}) => {
  await fixture(page, false);
  await page.getByRole("button", { name: "获取登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "获取登录二维码" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((r: any) => r.command === "music_login")
        .map((r: any) => r.args.action),
    ),
  ).toEqual(["start", "start", "cancel"]);
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((r: any) => r.command === "music_login")
        .map((r: any) => r.args.provider),
    ),
  ).toEqual(["qq", "qq", "qq"]);
});

test("platform connections follow provider capabilities and cancel the old login before switching", async ({
  page,
}) => {
  await fixture(page, false);
  const platforms = page.getByRole("complementary", { name: "音乐平台" });
  await expect(
    platforms.getByRole("button", { name: "QQ 音乐 可连接" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    platforms.getByRole("button", { name: "网易云音乐 待接入" }),
  ).toBeDisabled();
  await expect(
    platforms.getByRole("button", { name: "酷狗音乐 待接入" }),
  ).toBeDisabled();
  await expect(platforms.getByRole("button")).toHaveCount(3);
  await expect(platforms.getByText("酷我音乐")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).commands.filter((r: any) => r.command === "music_login"),
    ),
  ).toEqual([]);
  // A fixture-only provider proves the view does not route every platform to QQ.
  await page.evaluate(() =>
    (window as any).musicState.providers.push({
      id: "test-provider",
      name: "测试平台",
      capabilities: ["qr-login"],
    }),
  );
  const other = platforms.getByRole("button", { name: "测试平台 可连接" });
  await expect(other).toBeEnabled();
  await page.getByRole("button", { name: "获取登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).rejectLoginCancel = true));
  await other.click();
  await expect(page.getByRole("alert")).toContainText("取消登录失败");
  await expect(other).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).rejectLoginCancel = false));
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "获取登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "测试平台登录二维码" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((r: any) => r.command === "music_login")
        .map((r: any) => r.args),
    ),
  ).toEqual([
    { action: "start", provider: "qq" },
    { action: "cancel", provider: "qq" },
    { action: "cancel", provider: "qq" },
    { action: "start", provider: "test-provider" },
  ]);
});

test("NetEase recovery keeps its platform and failed cancellation cannot switch to QQ", async ({ page }) => {
  await fixture(page, false);
  await page.evaluate(() => {
    (window as any).musicState.providers.push({ id: "netease", name: "网易云音乐", capabilities: ["qr-login"] });
    (window as any).musicState.login = { provider: "netease", phase: "restoring", qr: null, message: "正在恢复网易云音乐登录…" };
  });
  const netease = page.getByRole("button", { name: "网易云音乐 可连接" });
  const qq = page.getByRole("button", { name: "QQ 音乐 可连接" });
  await expect(netease).toHaveAttribute("aria-pressed", "true");
  await expect(qq).toBeDisabled();
  await page.evaluate(() => ((window as any).musicState.login.phase = "error"));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("img", { name: "网易云音乐登录二维码" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "打开网易云音乐 App" })).toBeVisible();
  await page.getByRole("button", { name: "打开官方授权" }).click();
  await page.evaluate(() => ((window as any).rejectLoginCancel = true));
  await qq.click();
  await expect(page.getByRole("alert")).toContainText("取消登录失败");
  await expect(netease).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => ((window as any).rejectLoginCancel = false));
  await qq.click();
  await expect(qq).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "获取登录二维码" }).click();
  await expect(page.getByRole("img", { name: "QQ 音乐登录二维码" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).commands.filter((r: any) => r.command === "music_login").map((r: any) => r.args))).toEqual([
    { action: "start", provider: "netease" },
    { action: "official", provider: "netease" },
    { action: "cancel", provider: "netease" },
    { action: "cancel", provider: "netease" },
    { action: "start", provider: "qq" },
  ]);
});

test("login shows recovery, scanned, expired and error states with working recovery actions", async ({
  page,
}) => {
  await fixture(page, false);
  await page.evaluate(
    () =>
      ((window as any).musicState.login = {
        phase: "restoring",
        qr: null,
        message: "正在恢复上次的登录…",
      }),
  );
  await expect(
    page.getByRole("button", { name: "正在恢复登录…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "QQ 音乐 可连接" }),
  ).toBeDisabled();
  await page.evaluate(
    () =>
      ((window as any).musicState.login = {
        phase: "scanned",
        qr: null,
        message: "扫码成功，请在手机上确认",
      }),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "扫码成功" }),
  ).toBeVisible();
  await expect(page.locator(".library-qr .spinning")).toHaveCount(0);
  await page.evaluate(
    () =>
      ((window as any).musicState.login = {
        phase: "expired",
        qr: null,
        message: "二维码已过期",
      }),
  );
  await page.getByRole("button", { name: "刷新二维码", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      ((window as any).musicState.login = {
        phase: "error",
        qr: null,
        message: "网络连接失败",
      }),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "网络连接失败" }),
  ).toBeVisible();
  await expect(page.locator(".library-qr .spinning")).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QQ 音乐登录二维码" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开官方授权" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((r: any) => r.command === "music_login")
        .map((r: any) => r.args),
    ),
  ).toEqual([
    { action: "start", provider: "qq" },
    { action: "start", provider: "qq" },
    { action: "official", provider: "qq" },
  ]);
});

for (const layout of [
  { name: "light", theme: "light", width: 1280, height: 840 },
  { name: "dark", theme: "dark", width: 1280, height: 840 },
  { name: "compact", theme: "light", width: 760, height: 620 },
  { name: "narrow", theme: "light", width: 390, height: 740 },
]) {
  test(`${layout.name} platform login fits the music workspace`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await fixture(page, false);
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      layout.theme,
    );
    await expect(
      page.getByRole("button", { name: "QQ 音乐 可连接" }),
    ).toBeEnabled();
    await page.screenshot({ path: `artifacts/music-login-${layout.name}.png` });
    const bounds = await page.locator(".library-connect-panel").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(layout.width);
    expect(
      await page
        .locator(".library-login-layout")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "获取登录二维码" }).click();
    await expect(
      page.getByRole("img", { name: "QQ 音乐登录二维码" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "打开官方授权" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "打开官方授权" }),
    ).toBeInViewport();
    const login = await page.locator(".library-login-card").boundingBox();
    await expect(page.locator(".library-player")).toHaveCount(0);
    const official = await page
      .getByRole("button", { name: "打开官方授权" })
      .boundingBox();
    expect(login!.x + login!.width).toBeLessThanOrEqual(layout.width);
    expect(official!.y + official!.height).toBeLessThanOrEqual(layout.height);
  });
}

test("background player uses a valid range resource and seeks only on a seek command", async ({
  page,
}) => {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicPlayer } from '/src/features/music/music-player.tsx';
    window.playerState={generation:1,revision:1,seekRevision:0,ready:true,playing:true,position:0,volume:0};
    window.Audio=class {constructor(){window.testAudio=this;this.readyState=4;this.currentTime=0;this.duration=180;this.paused=true;this.ended=false}addEventListener(){}removeEventListener(){}load(){}removeAttribute(){}pause(){this.paused=true}async play(){this.paused=false}};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={convertFileSrc:(path,protocol)=>'http://'+protocol+'.localhost/'+encodeURIComponent(path),transformCallback:()=>1,invoke:async(command)=>command==='music_player_state'?structuredClone(window.playerState):1};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicPlayer));
  `,
    }),
  );
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio?.src))
    .toBe("http://music.localhost/stream/1");
  await page.evaluate(() => {
    const w = window as any;
    w.testAudio.currentTime = 42;
    w.playerState.volume = 0.3;
    w.playerState.revision++;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.volume))
    .toBe(0.3);
  expect(await page.evaluate(() => (window as any).testAudio.currentTime)).toBe(
    42,
  );
  await page.evaluate(() => {
    const s = (window as any).playerState;
    s.position = 55;
    s.seekRevision++;
    s.revision++;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.currentTime))
    .toBe(55);
});

test("transport shows actual decoded quality and explains automatic fallback", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const p = (window as any).musicState.playback;
    p.queue = [
      {
        id: "one",
        provider: "qq",
        title: "示例歌曲",
        artist: "示例歌手",
        album: "",
        cover: null,
        duration: 180,
        paid: true,
      },
    ];
    p.phase = "playing";
    p.quality = {
      id: "AI00",
      label: "臻品母带",
      codec: "FLAC",
      sampleRate: 192000,
      bitDepth: 24,
      channels: 2,
      bitrate: 5000000,
      fallback: null,
    };
  });
  const badge = page.getByLabel("当前播放音质");
  await expect(badge).toContainText("臻品母带");
  await expect(badge).toContainText("24bit · 192kHz · 2 声道");
  await expect(badge).not.toContainText("已自动降级");
  await page.evaluate(() => {
    (window as any).musicState.playback.quality = {
      id: "F000",
      label: "SQ 无损",
      codec: "FLAC",
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      bitrate: 900000,
      fallback: "较高音质未获授权，已自动降级",
    };
  });
  await expect(badge).toContainText("16bit · 44.1kHz");
  await expect(badge).toContainText("已自动降级");
  await expect(badge).not.toHaveAttribute("title");
  await badge.hover();
  await expect(page.getByRole("tooltip")).toContainText("较高音质未获授权");
  await expect(badge).not.toContainText("192kHz");
});

test("undecodable media reports errors before metadata and restores position after fallback", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicPlayer } from '/src/features/music/music-player.tsx';
    window.playerState={generation:1,revision:1,seekRevision:0,ready:true,playing:true,position:42,volume:0};
    window.feedback=[]; window.audioListeners={};
    window.Audio=class {constructor(){window.testAudio=this;this.readyState=0;this.currentTime=0;this.duration=NaN;this.paused=true;this.ended=false}addEventListener(n,f){window.audioListeners[n]=f}removeEventListener(){}load(){}removeAttribute(){}pause(){this.paused=true}async play(){if(this.readyState===0)throw Error('decode');this.paused=false}};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={convertFileSrc:(path,protocol)=>'http://'+protocol+'.localhost/'+encodeURIComponent(path),transformCallback:()=>1,invoke:async(command,args)=>{if(command==='music_player_state')return structuredClone(window.playerState);if(command==='music_player_feedback')window.feedback.push(args.feedback);return 1}};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicPlayer));
  `,
    }),
  );
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).feedback.some(
          (f: any) => f.error && f.position === 42 && f.generation === 1,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    w.playerState.generation = 2;
    w.playerState.revision++;
    w.playerState.seekRevision++;
    w.testAudio.readyState = 4;
    w.testAudio.duration = 180;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.src))
    .toBe("http://music.localhost/stream/2");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.currentTime))
    .toBe(42);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).feedback.some(
          (f: any) => f.generation === 2 && f.playing && !f.error,
        ),
      ),
    )
    .toBe(true);
});

async function activePlayback(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    Object.assign(w.musicState.playback, {
      queue: ["one", "two"].map((id, i) => ({
        id,
        provider: "qq",
        title: `测试歌曲${i}`,
        artist: "示例歌手",
        album: "示例专辑",
        cover: null,
        duration: 180,
        paid: false,
      })),
      phase: "playing",
      playing: true,
      generation: 1,
      duration: 180,
      position: 12,
      canNext: true,
      quality: {
        id: "F000",
        label: "SQ 无损",
        codec: "FLAC",
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        bitrate: 900000,
        fallback: null,
      },
    });
    w.musicLyrics = {
      key: "测试歌曲0\u001f示例歌手\u001f示例专辑",
      status: "ready",
      message: "本地歌词缓存",
      file: null,
      lines: [
        { text: "第一句原创歌词", start: 0, end: 10000, words: [] },
        { text: "第二句原创歌词", start: 10000, end: 20000, words: [] },
      ],
    };
  });
  await expect(page.getByLabel("当前播放音质")).toBeVisible();
}

test("cached lyrics support seek and refresh independently of the queue panel", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.getByRole("button", { name: "歌曲歌词", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "歌曲歌词面板" });
  await expect(panel.getByText("本地歌词缓存")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "第二句原创歌词" }),
  ).toHaveAttribute("aria-current", "true");
  await panel.getByRole("button", { name: "第二句原创歌词" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands.some(
          (c: any) =>
            c.command === "music_control" &&
            c.args.action === "seek" &&
            c.args.value === 10,
        ),
      ),
    )
    .toBe(true);
  await panel.getByRole("button", { name: "刷新歌词" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands.some(
          (c: any) => c.command === "music_lyrics" && c.args.refresh === true,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(panel).toHaveCount(0);
  const queue = page.getByRole("complementary", { name: "播放队列面板" });
  await queue.getByRole("button", { name: /2 测试歌曲1/ }).click();
  await queue.getByRole("button", { name: "从队列移除 测试歌曲1" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands
          .filter((c: any) => c.command === "music_queue_edit")
          .map((c: any) => c.args.edit),
      ),
    )
    .toEqual([{ action: "remove", entries: ["legacy-1"] }]);
  await queue.getByRole("button", { name: "清空" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands
          .filter((c: any) => c.command === "music_control")
          .map((c: any) => [c.args.action, c.args.value]),
      ),
    )
    .toEqual([
      ["seek", 10],
      ["queue-jump", 1],
      ["clear", null],
    ]);
});

test("external source keeps a visible resume action without enabling seek", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      suspended: true,
      playing: false,
      phase: "suspended",
      position: 43,
    }),
  );
  await expect(
    page.getByText("外部音源中 · 点击播放恢复内置音源"),
  ).toBeVisible();
  await expect(page.getByRole("slider", { name: "播放进度" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "切回外部音源" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands.some(
          (c: any) => c.command === "music_control" && c.args.action === "play",
        ),
      ),
    )
    .toBe(true);
});

test("credits are deduplicated and never highlighted as timed lyrics", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.evaluate(() => {
    const w = window as any;
    w.musicLyrics.lines = [
      "作词：原创作者",
      "作曲：原创作者",
      "作词：原创作者",
      "统筹：原创作者",
      "制作公司：原创工作室",
      "【未经著作权人许可不得翻唱翻录或使用】",
    ].map((text, i) => ({
      text,
      start: i * 1000,
      end: (i + 1) * 1000,
      words: [],
    }));
  });
  await page.getByRole("button", { name: "歌曲歌词", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "歌曲歌词面板" });
  await expect(panel.getByText("这首歌暂未提供正文歌词")).toBeVisible();
  await expect(panel.locator("button[aria-current]")).toHaveCount(0);
  await expect(
    panel.getByText("作词：原创作者", { exact: true }),
  ).not.toBeVisible();
  await panel.getByText("歌曲制作信息 · 5 项", { exact: true }).click();
  await expect(
    panel.getByText("作词：原创作者", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("作词：原创作者", { exact: true })).toHaveCount(
    1,
  );
});

test("mixed lyrics preserve repeated verses and the original seek timestamps", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.evaluate(() => {
    const w = window as any;
    w.musicLyrics.lines = [
      "作词：原创作者",
      "重复的一句歌词",
      "重复的一句歌词",
    ].map((text, i) => ({
      text,
      start: i * 10000,
      end: (i + 1) * 10000,
      words: [],
    }));
  });
  await page.getByRole("button", { name: "歌曲歌词", exact: true }).click();
  const lyrics = page.getByRole("button", { name: "重复的一句歌词" });
  await expect(lyrics).toHaveCount(2);
  await expect(lyrics.first()).toHaveAttribute("aria-current", "true");
  await lyrics.last().click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands.some(
          (c: any) =>
            c.command === "music_control" &&
            c.args.action === "seek" &&
            c.args.value === 20,
        ),
      ),
    )
    .toBe(true);
});

test("source menu can resume builtin playback and switch back to external selection", async ({
  page,
}) => {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { AudioSourcePanel } from '/src/features/audio/audio-source-panel.tsx';
    import '/src/index.css';
    window.commands=[];
    const snapshot={selection:{mode:'auto'},error:null,catalog:[],discovery:{targets:[],warning:null},builtin:{active:false,resumable:true}};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      window.commands.push({command,args});
      if(command==='get_audio_sources')return structuredClone(snapshot);
      if(command==='music_control'){snapshot.builtin.active=true;return;}
      if(command==='set_audio_source'){snapshot.builtin.active=false;snapshot.selection=args.selection;return args.selection;}
      throw new Error(command);
    }};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AudioSourcePanel,{active:true,status:{state:'silent',message:'',sourceName:null}}));
  `,
    }),
  );
  await page.goto("/");
  const selector = page.getByRole("combobox", {
    name: "音乐来源",
    exact: true,
  });
  await expect(selector).toHaveText("自动识别");
  await selector.click();
  await page.getByRole("option", { name: /内置播放/ }).click();
  await expect(selector).toHaveText("内置播放");
  await expect(page).toHaveURL(/#music$/);
  await selector.click();
  await page.getByRole("option", { name: /自动识别/ }).click();
  await expect(selector).toHaveText("自动识别");
  expect(
    await page.evaluate(() =>
      (window as any).commands.filter(
        (c: any) =>
          c.command === "music_control" || c.command === "set_audio_source",
      ),
    ),
  ).toEqual([
    { command: "music_control", args: { action: "play", value: null } },
    { command: "set_audio_source", args: { selection: { mode: "auto" } } },
  ]);
});

test("transport keeps controls usable and contained on wide and narrow windows", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.getByRole("button", { name: "播放模式：顺序播放" }).click();
  await page.getByRole("button", { name: "静音", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).commands
          .filter((c: any) => c.command === "music_control")
          .map((c: any) => c.args.action),
      ),
    )
    .toEqual(["mode", "mute"]);
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 840 });
    const footer = page.getByLabel("音乐播放栏");
    for (const label of [
      "歌曲歌词",
      "播放队列",
      "播放模式：顺序播放",
      "播放音量",
      "播放进度",
      "暂停",
    ]) {
      const control = footer.getByLabel(label, { exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(840);
    }
    if (width === 1280) {
      const box = await footer
        .getByRole("button", { name: "暂停", exact: true })
        .boundingBox();
      expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    }
  }
});

test("drawers close outside and with Escape while inside and toggle clicks stay predictable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 840 });
  await fixture(page);
  await activePlayback(page);
  const lyrics = page.getByRole("complementary", { name: "歌曲歌词面板" });
  const queue = page.getByRole("complementary", { name: "播放队列面板" });
  const toggle = page.getByRole("button", { name: "歌曲歌词", exact: true });
  await toggle.click();
  await lyrics.getByRole("button", { name: "第二句原创歌词" }).click();
  await expect(lyrics).toBeVisible();
  await page.getByRole("heading", { name: "音乐库", exact: true }).click();
  await expect(lyrics).toHaveCount(0);
  await toggle.click();
  await toggle.click();
  await expect(lyrics).toHaveCount(0);
  await toggle.click();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(lyrics).toHaveCount(0);
  await expect(queue).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(queue).toHaveCount(0);
  await toggle.click();
  await lyrics.getByRole("button", { name: "收起面板" }).click();
  await expect(lyrics).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("timeline combines playback, download and seek states and separates time ranges from byte progress", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  const states = page.locator(".library-timeline");
  const download = page.getByRole("progressbar", { name: "音频下载进度" });
  const slider = page.getByRole("slider", { name: "播放进度" });
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      phase: "loading",
      loadStage: "authorizing",
      quality: null,
      playing: false,
    }),
  );
  await expect(states).toHaveAttribute("data-states", "authorizing");
  await expect(slider).toBeDisabled();
  await expect(page.locator(".library-track-info")).not.toContainText("授权");
  await page.evaluate(
    () => ((window as any).musicState.playback.loadStage = "buffering"),
  );
  await expect(states).toHaveAttribute("data-states", "buffering");
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      phase: "playing",
      playing: true,
      buffered: [
        [0, 30],
        [120, 150],
      ],
      transfer: { status: "downloading", received: 4194304, total: 10485760 },
    }),
  );
  await expect(states).toHaveAttribute("data-states", "playing downloading");
  await expect(
    page.locator(".library-progress-track > .library-progress-download"),
  ).toBeVisible();
  await expect(page.locator(".library-progress-track")).toHaveCount(1);
  await expect(
    page.locator(".library-download-track, .library-progress-states"),
  ).toHaveCount(0);
  await expect(states).toHaveText("0:123:00");
  await expect(download).toHaveAttribute("aria-valuenow", "40");
  await expect(download).toHaveAttribute(
    "aria-valuetext",
    "40% · 4.0 / 10.0 MB",
  );
  await expect(page.locator(".library-progress-buffer")).toHaveCount(2);
  const ranges = await page
    .locator(".library-progress-buffer")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: parseFloat((n as HTMLElement).style.left),
        width: parseFloat((n as HTMLElement).style.width),
      })),
    );
  expect(ranges[0].left).toBe(0);
  expect(ranges[0].width).toBeCloseTo((30 / 180) * 100);
  expect(ranges[1].left).toBeCloseTo((120 / 180) * 100);
  await expect(slider).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      playing: false,
      phase: "paused",
    }),
  );
  await expect(states).toHaveAttribute("data-states", "paused downloading");
  expect(
    await download.evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("library-download-flow");
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      phase: "buffering",
      playing: true,
      seeking: true,
    }),
  );
  await expect(states).toHaveAttribute(
    "data-states",
    "seeking buffering downloading",
  );
  await expect(download).toBeVisible();
  await expect(page.locator(".library-progress-loading")).toBeVisible();
  await page.evaluate(() => {
    const p = (window as any).musicState.playback;
    Object.assign(p, { phase: "playing", seeking: false });
    p.transfer.status = "complete";
    p.transfer.received = p.transfer.total;
  });
  await expect(states).toHaveAttribute("data-states", "playing");
  await expect(download).toHaveCount(0);
  await expect(page.locator(".library-progress-loading")).toHaveCount(0);
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).commands
            .filter((c: any) => c.command === "music_control")
            .at(-1)?.args,
      ),
    )
    .toMatchObject({ action: "seek", value: 12.1 });
  await page.evaluate(
    () => ((window as any).musicState.playback.transfer.status = "cached"),
  );
  await expect(states).toHaveAttribute("data-states", "playing");
  await expect(download).toHaveCount(0);
  await expect(states).not.toContainText(/已下载|本地缓存/);
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      suspended: true,
      playing: false,
      phase: "suspended",
    }),
  );
  await expect(states).toHaveAttribute("data-states", "suspended");
  await expect(download).toHaveCount(0);
});

test("progressive player keeps pause responsive while play waits for network and reports buffering", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicPlayer } from '/src/features/music/music-player.tsx';
    window.playerState={generation:1,revision:1,seekRevision:0,ready:true,playing:true,position:42,volume:0,streamUrl:'http://127.0.0.1:12345/audio/test'};
    window.feedback=[]; window.pauses=0;
    window.Audio=class {constructor(){window.testAudio=this;this.readyState=0;this.currentTime=0;this.duration=NaN;this.paused=true;this.ended=false}addEventListener(){}removeEventListener(){}load(){}removeAttribute(){}pause(){this.paused=true;window.pauses++}play(){this.paused=false;return new Promise(()=>{})}};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={transformCallback:()=>1,invoke:async(command,args)=>{if(command==='music_player_state')return structuredClone(window.playerState);if(command==='music_player_feedback')window.feedback.push(args.feedback);return 1}};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicPlayer));
  `,
    }),
  );
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio?.src))
    .toBe("http://127.0.0.1:12345/audio/test");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).feedback.some(
          (f: any) =>
            f.buffering && !f.error && !f.playing && f.position === 42,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as any).playerState.playing = false;
    (window as any).playerState.revision++;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.paused))
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).feedback.some((f: any) => f.error),
    ),
  ).toBe(false);
});

test("timeline layers and simultaneous states fit narrow windows and respect reduced motion", async ({
  page,
}) => {
  await fixture(page);
  await activePlayback(page);
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      phase: "buffering",
      playing: true,
      seeking: true,
      buffered: [
        [0, 20],
        [140, 160],
      ],
      transfer: { status: "downloading", received: 4194304, total: 10485760 },
    }),
  );
  const rail = page.locator(".library-progress-rail");
  await expect(page.locator(".library-timeline")).toHaveAttribute(
    "data-states",
    "seeking buffering downloading",
  );
  for (const width of [1280, 640, 390]) {
    await page.setViewportSize({ width, height: 840 });
    const box = await rail.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(840);
    const fit = await rail.evaluate((n) => n.scrollWidth <= n.clientWidth);
    expect(fit).toBe(true);
    const track = await page.locator(".library-progress-track").boundingBox();
    const download = await page
      .locator(".library-progress-download")
      .boundingBox();
    expect(download!.y).toBe(track!.y);
    expect(download!.height).toBe(track!.height);
    expect(download!.width / track!.width).toBeCloseTo(0.4, 1);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".library-progress-download")
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".library-progress-loading")
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
});

test("background player reports disjoint decoded ranges without replacing them with byte percentages", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicPlayer } from '/src/features/music/music-player.tsx';
    window.playerState={generation:1,revision:1,seekRevision:0,ready:true,playing:true,position:120,volume:0};
    window.feedback=[];window.audioRanges=[[0,20],[120,140]];
    window.Audio=class {constructor(){window.testAudio=this;this.readyState=4;this.currentTime=120;this.duration=180;this.paused=true;this.ended=false;this.seeking=false;this.buffered={get length(){return window.audioRanges.length},start(i){return window.audioRanges[i][0]},end(i){return window.audioRanges[i][1]}}}addEventListener(){}removeEventListener(){}load(){}removeAttribute(){}pause(){this.paused=true}async play(){this.paused=false}};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={convertFileSrc:(path,protocol)=>'http://'+protocol+'.localhost/'+encodeURIComponent(path),transformCallback:()=>1,invoke:async(command,args)=>{if(command==='music_player_state')return structuredClone(window.playerState);if(command==='music_player_feedback')window.feedback.push(args.feedback);return 1}};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicPlayer));
  `,
    }),
  );
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).feedback.find((f: any) => f.playing)?.buffered,
      ),
    )
    .toEqual([
      [0, 20],
      [120, 140],
    ]);
  await page.evaluate(() => {
    (window as any).testAudio.seeking = true;
    (window as any).testAudio.readyState = 2;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).feedback.some(
          (f: any) => f.seeking && f.buffering && !f.playing && !f.error,
        ),
      ),
    )
    .toBe(true);
});

test("authenticated provider search paginates independently and plays the selected result", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("combobox", { name: "搜索范围" }).click();
  await page.getByRole("option", { name: "平台曲库", exact: true }).click();
  const input = page.getByRole("searchbox", { name: "全站搜索关键词" });
  await input.fill("晴天");
  await input.press("Enter");
  await expect(
    page.locator(".library-track strong").filter({ hasText: "晴天 (Live)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加载下一页", exact: true }).click();
  await expect(
    page.getByText("已加载 2 / 31 首", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放已加载歌曲" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).commands
          .filter((c: any) => c.command === "music_play")
          .at(-1).args,
    ),
  ).toEqual({ ids: ["qq:result0", "qq:result30"], index: 0 });
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((c: any) => c.command === "music_search")
        .map((c: any) => c.args.offset),
    ),
  ).toEqual([0, 30]);
});

test("local index virtualizes large lists, preserves keyboard navigation and sorted playback", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.localIndex = {
      items: Array.from({ length: 3000 }, (_, i) => ({
        id: "large" + i,
        provider: "qq",
        title: "歌曲" + String(i).padStart(4, "0"),
        artist: "艺人",
        album: "专辑",
        duration: 3000 - i,
        cover: null,
        paid: false,
      })),
      total: 3000,
      synced: 3000,
      complete: true,
      updated: 1,
    };
  });
  await page.getByRole("combobox", { name: "搜索范围" }).click();
  await page.getByRole("option", { name: "已同步歌曲", exact: true }).click();
  await expect(
    page.getByText("已加载 3000 / 3000 首", { exact: true }),
  ).toBeVisible();
  expect(await page.locator(".library-track").count()).toBeLessThan(60);
  await page.locator(".library-track").first().focus();
  await page.keyboard.press("End");
  await expect(
    page.locator(".library-track").filter({ hasText: "歌曲2999" }),
  ).toBeFocused();
  await page.getByRole("combobox", { name: "歌曲排序" }).click();
  await page.getByRole("option", { name: "时长", exact: true }).click();
  await page.getByRole("button", { name: "播放已加载歌曲" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .find((c: any) => c.command === "music_play")
        .args.ids.slice(0, 3),
    ),
  ).toEqual(["qq:large2999", "qq:large2998", "qq:large2997"]);
});

test("native loading keeps controls operable and queue context actions preserve playback", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const p = (window as any).musicState.playback;
    p.queue = [
      {
        id: "current",
        provider: "qq",
        title: "当前",
        artist: "歌手",
        album: "专辑",
        duration: 180,
        cover: null,
        paid: false,
      },
    ];
    p.playing = true;
    p.phase = "loading";
    p.canNext = true;
  });
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).commands.some(
        (c: any) => c.command === "music_control" && c.args.action === "pause",
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "我喜欢", exact: true }).click();
  await page
    .locator(".library-track")
    .first()
    .click({ button: "right", position: { x: 75, y: 20 } });
  await page.getByRole("menuitem", { name: "下一首播放", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).commands.find(
          (c: any) => c.command === "music_queue_edit",
        ).args.edit,
    ),
  ).toEqual({ action: "append", ids: ["qq:song0"], next: true });
});

async function longLyricsFixture(page: Page) {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    Object.assign(w.musicState.playback, {
      generation: 1,
      index: 0,
      position: 10,
      phase: "paused",
      queue: [
        {
          id: "lyric",
          provider: "qq",
          title: "歌词歌",
          artist: "歌手",
          album: "专辑",
          duration: 180,
          cover: null,
          paid: false,
        },
      ],
    });
    w.musicLyrics = {
      key: "歌词歌\u001f歌手\u001f专辑",
      status: "ready",
      message: "歌词",
      lines: Array.from({ length: 60 }, (_, i) => ({
        start: i * 1000,
        end: (i + 1) * 1000,
        text: "测试歌词" + i,
        words: [],
      })),
      issue: null,
    };
  });
  await page.getByRole("button", { name: "歌曲歌词", exact: true }).click();
  await expect(page.getByText("测试歌词10", { exact: true })).toBeVisible();
}

test("lyric follow animates without changing row heights and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await longLyricsFixture(page);
  const body = page.locator(".library-lyrics-body");
  const samples = await body.evaluate(async (root) => {
    (window as any).musicState.playback.position = 20;
    const values: number[] = [];
    const at = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        values.push(root.scrollTop);
        if (performance.now() - at < 1600) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return values;
  });
  expect(new Set(samples.map(Math.round)).size).toBeGreaterThan(8);
  expect(samples.at(-1)! - samples[0]).toBeGreaterThan(400);
  const centered = () =>
    body.evaluate((root) => {
      const line = root.querySelector<HTMLElement>('[aria-current="true"]')!;
      return Math.abs(
        line.offsetTop +
          line.offsetHeight / 2 -
          root.scrollTop -
          root.clientHeight / 2,
      );
    });
  await expect.poll(centered).toBeLessThan(2);
  const heights = await body
    .locator("button")
    .evaluateAll((lines) =>
      lines.map((line) => (line as HTMLElement).offsetHeight),
    );
  expect(new Set(heights).size).toBe(1);
  await expect(
    body.locator('[aria-current="true"] .library-lyric-text'),
  ).toHaveCSS("transition-duration", "0.52s, 0.42s");
  await page.screenshot({ path: "artifacts/music-lyrics-smooth.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () => ((window as any).musicState.playback.position = 30),
  );
  await expect(body.locator('[aria-current="true"]')).toHaveText("测试歌词30");
  await expect.poll(centered).toBeLessThan(2);
  expect(
    await body
      .locator('[aria-current="true"] .library-lyric-text')
      .evaluate((node) =>
        parseFloat(getComputedStyle(node).transitionDuration),
      ),
  ).toBeLessThan(0.001);
  await page.evaluate(() =>
    Object.assign((window as any).musicState.playback, {
      position: 30.8,
      playing: true,
      phase: "playing",
    }),
  );
  await expect(body.locator('[aria-current="true"]')).toHaveText("测试歌词31");
});

test("lyric browsing stays manual and per-song offsets are stored separately", async ({
  page,
}) => {
  await longLyricsFixture(page);
  await expect(page.getByText("测试歌词10", { exact: true })).toBeVisible();
  const body = page.locator(".library-lyrics-body");
  const height = await body.evaluate((root) => root.clientHeight);
  await page
    .locator(".library-lyrics-body")
    .dispatchEvent("wheel", { deltaY: 200 });
  await expect(page.getByRole("button", { name: "回到当前句" })).toBeVisible();
  const top = await body.evaluate((root) => {
    root.scrollTop = 100;
    return root.scrollTop;
  });
  await page.evaluate(
    () => ((window as any).musicState.playback.position = 20),
  );
  await expect(body.locator('[aria-current="true"]')).toHaveText("测试歌词20");
  expect(await body.evaluate((root) => root.scrollTop)).toBe(top);
  expect(await body.evaluate((root) => root.clientHeight)).toBe(height);
  await page.getByRole("button", { name: "回到当前句" }).click();
  await expect
    .poll(() => body.evaluate((root) => root.scrollTop))
    .toBeGreaterThan(top + 500);
  await page.getByRole("button", { name: "延后 0.5 秒" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).commands.find((c: any) => c.command === "music_offset")
          .args.value,
    ),
  ).toBe(0.5);
});

test("cache settings default normalization off and expose typed controls", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "音乐库设置", exact: true }).click();
  await expect(
    page.getByRole("tablist", { name: "音乐库设置分类" }).getByRole("tab"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("tab", { name: "缓存", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("switch", { name: "歌曲响度平衡" })).toHaveCount(
    0,
  );
  await page.getByRole("combobox", { name: "歌词缓存容量" }).click();
  await page.getByRole("option", { name: "16 MiB", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "清理音频", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("保存歌词与封面，歌曲不占用磁盘缓存"),
  ).toBeVisible();
  await expect(page.locator(".library-settings")).toHaveCSS(
    "scrollbar-width",
    "none",
  );
  await page.getByRole("button", { name: "清理歌词", exact: true }).click();
  await expect(
    page.getByText("当前歌曲正在使用的缓存会在释放后清理。"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "歌曲响度平衡" }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: "歌曲响度平衡" }).check();
  await page.getByRole("combobox", { name: "睡眠定时" }).click();
  await page.getByRole("option", { name: "15 分钟", exact: true }).click();
  const calls = await page.evaluate(() => (window as any).commands);
  expect(
    calls.filter((c: any) => c.command === "music_preferences").at(-1).args
      .preferences,
  ).toEqual({ lyricMib: 16, normalize: true });
  expect(
    calls.some(
      (c: any) =>
        c.command === "music_control" &&
        c.args.action === "sleep" &&
        c.args.value === 900,
    ),
  ).toBe(true);
});

test("settings dropdowns stay inside the drawer interaction and Escape closes one layer", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "音乐库设置", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "音乐库设置面板" });
  const capacity = page.getByRole("combobox", { name: "歌词缓存容量" });
  await capacity.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await capacity.click();
  await page.getByRole("option", { name: "64 MiB", exact: true }).click();
  await expect(capacity).toHaveText("64 MiB");
  await expect(panel).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).prefs.lyricMib))
    .toBe(64);
  await page.getByRole("tab", { name: "工具", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "导出播放诊断" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "播放", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "睡眠定时" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "音乐库设置", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "播放", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

for (const layout of [
  { name: "light", theme: "light", width: 1280, height: 840 },
  { name: "dark", theme: "dark", width: 1280, height: 840 },
  { name: "compact", theme: "light", width: 520, height: 600 },
]) {
  test(`${layout.name} music overlays and hover hints remain readable within the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fixture(page);
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      layout.theme,
    );
    const withinViewport = async (selector: string) => {
      await expect
        .poll(async () => {
          const bounds = await page.locator(selector).boundingBox();
          return Boolean(
            bounds &&
              bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= layout.width &&
              bounds.y + bounds.height <= layout.height,
          );
        })
        .toBe(true);
    };
    const settings = page.getByRole("button", {
      name: "音乐库设置",
      exact: true,
    });
    await settings.hover();
    await expect(page.getByRole("tooltip")).toHaveText("音乐库设置");
    await expect(settings).not.toHaveAttribute("title");
    await withinViewport(".library-tooltip");
    await page.screenshot({
      path: `artifacts/music-ui-${layout.name}-tooltip.png`,
    });
    await settings.click();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await withinViewport(".library-panel");
    await expect(page.getByRole("heading", { name: "本地缓存" })).toBeVisible();
    await page.getByRole("combobox", { name: "歌词缓存容量" }).click();
    await withinViewport(".library-choice-menu");
    await page.screenshot({
      path: `artifacts/music-ui-${layout.name}-settings.png`,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "工具", exact: true }).click();
    await page
      .getByRole("button", { name: "导出播放诊断" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "导出播放诊断" }),
    ).toBeInViewport();
    await page.getByRole("tab", { name: "播放", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "睡眠定时" }),
    ).toBeVisible();
    await withinViewport(".library-settings-tabs");
    await page.screenshot({
      path: `artifacts/music-tabs-${layout.name}-playback.png`,
    });
    await page.getByRole("button", { name: "收起面板" }).click();
    await page.getByRole("button", { name: "我喜欢", exact: true }).click();
    const track = page.locator(".library-track").first();
    await expect(track).toBeVisible();
    await track.click({ button: "right", position: { x: 75, y: 20 } });
    await expect(
      page.getByRole("menuitem", { name: "加入队列", exact: true }),
    ).toBeVisible();
    await withinViewport(".library-context-menu");
    await page.screenshot({
      path: `artifacts/music-ui-${layout.name}-context.png`,
    });
    await page.getByRole("menuitem", { name: "加入队列", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).commands.some(
            (c: any) =>
              c.command === "music_queue_edit" && c.args.edit.next === false,
          ),
        ),
      )
      .toBe(true);
    const lyrics = page.getByRole("button", { name: "歌曲歌词", exact: true });
    await lyrics.hover();
    await expect(page.getByRole("tooltip")).toContainText("查看歌词");
    await withinViewport(".library-tooltip");
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.locator(".workspace-music [title]")).toHaveCount(0);
  });
}

test("track selection, inline actions and density remain independent of playback", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "我喜欢", exact: true }).click();
  const row = page.locator(".library-track").first();
  await row.click({ position: { x: 75, y: 20 } });
  await expect(row).toHaveAttribute("aria-pressed", "true");
  const rowBox = (await page
    .locator(".library-track-row")
    .first()
    .boundingBox())!;
  const actionsBox = (await page
    .locator(".library-row-actions")
    .first()
    .boundingBox())!;
  expect(
    Math.abs(actionsBox.x + actionsBox.width / 2 - rowBox.x - rowBox.width / 2),
  ).toBeLessThan(1);
  const titleBox = (await row.locator(".library-track-title").boundingBox())!;
  const albumBox = (await row.locator(".library-track-album").boundingBox())!;
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x);
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(albumBox.x);
  expect(
    await page.evaluate(
      () =>
        (window as any).commands.filter((c: any) => c.command === "music_play")
          .length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "下一首播放 歌曲0", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).commands.find(
            (c: any) => c.command === "music_queue_edit",
          )?.args.edit,
      ),
    )
    .toEqual({ action: "append", ids: ["qq:song0"], next: true });
  await page
    .getByRole("button", { name: "歌曲0 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "加入队列", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).commands.filter(
            (c: any) => c.command === "music_queue_edit",
          ).length,
      ),
    )
    .toBe(2);
  await page.getByRole("combobox", { name: "列表密度" }).click();
  await page.getByRole("option", { name: "紧凑", exact: true }).click();
  expect(
    await row.evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(49);
  await row.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).commands.filter(
            (c: any) => c.command === "music_play",
          ).length,
      ),
    )
    .toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "我喜欢", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "列表密度" })).toContainText(
    "紧凑",
  );
});

test("pinned lyrics and queue overlay without resizing the browser and narrow panels dismiss outside", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await activePlayback(page);
  const browser = page.locator(".library-browser");
  const before = await browser.boundingBox();
  const toggle = page.getByRole("button", { name: "歌曲歌词", exact: true });
  await toggle.click();
  const panel = page.getByRole("complementary", { name: "歌曲歌词面板" });
  await expect(panel).toHaveAttribute("data-docked", "true");
  expect(await browser.boundingBox()).toEqual(before);
  await page.getByRole("heading", { name: "音乐库", exact: true }).click();
  await expect(panel).toBeVisible();
  const layout = await panel.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    browserRight: document
      .querySelector(".library-browser")!
      .getBoundingClientRect().right,
  }));
  expect(layout.left).toBeLessThan(layout.browserRight);
  expect(layout.left).toBeGreaterThan(before!.x);
  await page.getByRole("button", { name: "收起面板", exact: true }).click();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  const queue = page.getByRole("complementary", { name: "播放队列面板" });
  await expect(queue).toBeVisible();
  expect(await browser.boundingBox()).toEqual(before);
  const queueBox = await queue.boundingBox();
  expect(queueBox!.x).toBeLessThan(layout.browserRight);
  await queue.getByRole("button", { name: "收起面板", exact: true }).click();
  await toggle.click();
  await panel.getByRole("button", { name: "停靠面板" }).click();
  await page.getByRole("heading", { name: "音乐库", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await panel.getByRole("button", { name: "停靠面板" }).click();
  await page.setViewportSize({ width: 760, height: 800 });
  await page.getByRole("heading", { name: "音乐库", exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test("music search has a single focus border in light, dark and narrow layouts", async ({
  page,
}) => {
  await fixture(page);
  const search = page.getByRole("searchbox", { name: "搜索已同步歌曲" });
  for (const [theme, width] of [
    ["light", 1440],
    ["dark", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await search.focus();
    const style = await search.evaluate((input) => ({
      outline: getComputedStyle(input).outlineStyle,
      border: getComputedStyle(input).borderWidth,
      shadow: getComputedStyle(input).boxShadow,
      outerShadow: getComputedStyle(input.parentElement!).boxShadow,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(style.outline).toBe("none");
    expect(style.border).toBe("0px");
    expect(style.shadow).toBe("none");
    expect(style.outerShadow).not.toBe("none");
    expect(style.overflow).toBe(false);
  }
});
