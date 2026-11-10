import { test, expect } from "@playwright/test";

for (const [provider, name] of [["qq", "QQ 音乐"], ["netease", "网易云音乐"], ["kugou", "酷狗音乐"]]) {
  test(`${name} keeps playlist reading and local queue without cloud editing`, async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { isTauri: true }));
    await page.route("**/src/main.tsx*", route => route.fulfill({
      contentType: "text/javascript",
      body: `
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import { MusicLibrary } from '/src/features/music/music-library.tsx';
        import { emptySnapshot } from '/src/features/music/types.ts';
        import '/src/index.css';
        window.commands=[];
        const state=structuredClone(emptySnapshot);
        state.providers=[{id:'${provider}',name:'${name}',capabilities:['qr-login','account','playlists','playback','search','lyrics']}];
        state.account={provider:'${provider}',nickname:'示例账号',avatar:null,membership:null,membershipIssue:null};
        const track={id:'123',provider:'${provider}',title:'示例歌曲',artist:'歌手',album:'专辑',cover:null,duration:180,paid:false};
        window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
          window.commands.push({command,args});
          if(command==='music_snapshot') return structuredClone(state);
          if(command==='music_browse') return args.value??null;
          if(command==='music_playlists') return {items:[{id:'12',name:'已有歌单',cover:null,count:1}],total:1,nextOffset:null,filtered:0};
          if(command==='music_tracks') return {items:[track],total:1,nextOffset:null,filtered:0};
          if(command==='music_library_data') return {items:[],total:0,synced:0,complete:false,updated:0,nextOffset:0};
          return null;
        }};
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',{className:'studio-shell',style:{height:'100dvh',display:'flex'}},React.createElement(MusicLibrary)));
      `,
    }));
    await page.goto('/#music');
    await expect(page.getByRole('button', { name: /新建歌单|收藏歌单|管理云端/ })).toHaveCount(0);
    await page.getByRole('button', { name: '已有歌单 1 首' }).click();
    await expect(page.getByText('示例歌曲', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /管理云端/ })).toHaveCount(0);
    await page.locator('.library-track-row').first().hover();
    await page.getByRole('button', { name: '示例歌曲 更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: /云端|喜欢|添加到.*歌单|从.*歌单移除/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '加入队列' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'music_queue_edit').at(-1)?.args.edit)).toEqual({ action: 'append', ids: [`${provider}:123`], next: false });
    await page.getByRole('button', { name: '播放 示例歌曲', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'music_play').at(-1)?.args)).toEqual({ ids: [`${provider}:123`], index: 0 });
    expect(await page.evaluate(() => (window as any).commands.some((c: any) => c.command.startsWith('music_cloud_')))).toBe(false);
  });
}
