import { test, expect } from "@playwright/test";
test("StrictMode restores the cached playlist and retains scroll through a full refresh", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.isTauri = true;
  });
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
 import React from '/node_modules/.vite/deps/react.js';
 import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import {MusicLibrary} from '/src/features/music/music-library.tsx';
 import {emptySnapshot} from '/src/features/music/types.ts';
 import '/src/index.css';
 window.calls=[];window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
 window.calls.push(command);
 if(command==='music_snapshot')return {...structuredClone(emptySnapshot),account:{provider:'qq',nickname:'测试',avatar:null,membership:null},providers:[{id:'qq',name:'QQ 音乐',capabilities:['search']}]};
 if(command==='music_browse')return args.value??{collection:'created',selected:{id:'1',name:'已恢复的歌单',cover:null,count:300},query:'',sort:'default',top:600};
 if(command==='music_playlists')return {items:[],total:0,nextOffset:null,filtered:0};
 const track=i=>({id:'s'+i,provider:'qq',title:'恢复歌曲'+i,artist:'测试',album:'测试',duration:180,cover:null,paid:false});
 if(command==='music_library_data')return {items:Array.from({length:300},(_,i)=>track(i)),total:300,synced:300,complete:true,updated:1};
 if(command==='music_tracks'){await new Promise(r=>setTimeout(r,250));return {items:Array.from({length:100},(_,i)=>track(args.offset+i)),total:300,nextOffset:args.offset<200?args.offset+100:null,filtered:0};}
 return null;}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement('div',{style:{height:'100vh',display:'flex'}},React.createElement(MusicLibrary))));
 `,
    }),
  );
  await page.goto("/#music");
  await expect(
    page.getByRole("heading", { name: "已恢复的歌单", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("已加载 300 / 300 首", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(
    page.getByText("已加载 300 / 300 首", { exact: true }),
  ).toBeVisible();
  const top = await page
    .locator(".library-scroll")
    .evaluate((n) => n.scrollTop);
  if (top < 500) throw Error("Browse scroll position was lost: " + top);
  expect(top).toBe(600);
});
