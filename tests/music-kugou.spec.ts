import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, connected = true, playable = false) {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.route("**/src/main.tsx*", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { MusicLibrary } from '/src/features/music/music-library.tsx';
      import { emptySnapshot } from '/src/features/music/types.ts';
      import '/src/index.css';
      window.commands=[];
      window.musicState=structuredClone(emptySnapshot);
      window.musicState.providers=[{id:'qq',name:'QQ 音乐',capabilities:['qr-login']},{id:'kugou',name:'酷狗音乐',capabilities:['qr-login','account','search','lyrics']}];
      if(${playable}) window.musicState.providers[1].capabilities.push('playlists','playback');
      if(${connected}) window.musicState.account={provider:'kugou',nickname:'酷狗示例账号',avatar:null,membership:null,membershipIssue:null};
      window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
        window.commands.push({command,args});
        if(command==='music_snapshot') return structuredClone(window.musicState);
        if(command==='music_browse') return args.value??${playable ? "null" : "{collection:'created',selected:{id:'liked',name:'我喜欢',cover:null,count:0},query:'',sort:'default',top:0}"};
        if(command==='music_playlists') return {items:[{id:'12',name:'酷狗实测歌单',cover:null,count:1}],total:1,nextOffset:null,filtered:0};
        if(command==='music_tracks') return {items:[{id:'abcdef0123456789abcdef0123456789_n123',provider:'kugou',title:'歌单歌曲',artist:'示例歌手',album:'示例专辑',cover:null,duration:186,paid:false}],total:1,nextOffset:null,filtered:0};
        if(command==='music_library_data') return {items:[],total:0,synced:0,complete:false,updated:0,nextOffset:0};
        if(command==='music_search') return {items:[{id:'abcdef0123456789abcdef0123456789_'+(args.offset+1),provider:'kugou',title:'示例歌曲'+args.offset,artist:'示例歌手',album:'示例专辑',cover:null,duration:264,paid:false}],total:31,nextOffset:args.offset===0?30:null,filtered:0};
        if(command==='music_track_lyrics') return {key:args.id,status:'ready',message:'',file:null,lines:[{text:'歌词预览内容',start:0,end:1000,words:[]}]};
        if(command==='music_login') { window.musicState.login=args.action==='cancel'?{phase:'',qr:null,message:''}:{provider:args.provider,phase:'waiting',qr:null,message:'使用酷狗音乐 App 扫码并确认登录'};return; }
        return null;
      }};
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',{className:'studio-shell',style:{height:'100dvh',display:'flex'}},React.createElement(MusicLibrary)));
    `,
  }));
  await page.goto("/#music");
}

test("Kugou with limited capabilities keeps search and lyric preview usable", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("heading", { name: "全站搜索" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "歌单分类" })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "全站搜索关键词" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("button", { name: "播放已加载歌曲" })).toHaveCount(0);
  await search.fill("示例");
  await search.press("Enter");
  await expect(page.getByText("示例歌曲0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "加载下一页" }).click();
  await expect(page.getByText("示例歌曲30", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "加载下一页" })).toHaveCount(0);
  const row = page.locator(".library-track-row").first();
  await row.hover();
  await page.getByRole("button", { name: "查看 示例歌曲0 歌词" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("歌词预览内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新歌词" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "music_track_lyrics").at(-1)?.args.refresh)).toBe(true);
  await page.screenshot({ path: "artifacts/kugou-lyrics-preview.png" });
  await page.getByRole("button", { name: "关闭歌词" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.hover();
  await page.getByRole("button", { name: "示例歌曲0 更多操作" }).click();
  await expect(page.getByRole("menuitem", { name: "查看歌词" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /播放|队列/ })).toHaveCount(0);
  const commands = await page.evaluate(() => (window as any).commands);
  expect(commands.filter((c: any) => c.command === "music_search").map((c: any) => c.args)).toEqual([{ query: "示例", offset: 0 }, { query: "示例", offset: 30 }]);
  expect(commands.filter((c: any) => ["music_playlists", "music_tracks", "music_library_data", "music_play", "music_queue_edit"].includes(c.command))).toEqual([]);
});

test("Kugou playback capabilities open playlists and dispatch native playback and queue actions", async ({ page }) => {
  await fixture(page, true, true);
  await expect(page.getByRole("navigation", { name: "歌单分类" })).toBeVisible();
  await page.getByRole("button", { name: "酷狗实测歌单 1 首" }).click();
  await expect(page.getByText("歌单歌曲", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放已加载歌曲" })).toBeVisible();
  const row = page.locator(".library-track-row").first();
  await row.hover();
  await page.getByRole("button", { name: "播放 歌单歌曲", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "music_play").length)).toBe(1);
  await row.hover();
  await page.getByRole("button", { name: "歌单歌曲 更多操作" }).click();
  await page.getByRole("menuitem", { name: "加入队列" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "music_queue_edit").at(-1)?.args.edit)).toEqual({ action: "append", ids: ["kugou:abcdef0123456789abcdef0123456789_n123"], next: false });
  const commands = await page.evaluate(() => (window as any).commands);
  expect(commands.find((c: any) => c.command === "music_tracks")?.args.playlist).toBe("12");
  expect(commands.find((c: any) => c.command === "music_play")?.args).toEqual({ ids: ["kugou:abcdef0123456789abcdef0123456789_n123"], index: 0 });
  await page.screenshot({ path: "artifacts/kugou-playback-library.png" });
});

test("Kugou login sends its own platform ID and uses the Kugou scanner guide", async ({ page }) => {
  await fixture(page, false);
  await page.getByRole("button", { name: /酷狗音乐/ }).click();
  await expect(page.getByText("打开酷狗音乐 App", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "获取登录二维码" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "music_login").at(-1)?.args)).toEqual({ action: "start", provider: "kugou" });
  await expect(page.getByRole("status")).toContainText("使用酷狗音乐 App");
});
