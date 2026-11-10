import { test, expect, type Page } from "@playwright/test";

async function loginControlsFixture(page: Page) {
  await page.addInitScript(() => { window.isTauri = true; });
  await page.route("**/src/main.tsx*", route => route.fulfill({ contentType: "text/javascript", body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicLibrary } from '/src/features/music/music-library.tsx';
    import { MusicProvider } from '/src/features/music/use-music.ts';
    import { emptySnapshot } from '/src/features/music/types.ts';
    import '/src/index.css';
    window.musicState=structuredClone(emptySnapshot); window.loginCalls=[];
    window.musicState.providers=[['qq','QQ 音乐'],['netease','网易云音乐'],['kugou','酷狗音乐']].map(([id,name])=>({id,name,capabilities:['qr-login','playlists','playback']}));
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='music_snapshot')return structuredClone(window.musicState);
      if(command==='music_login'){
        window.loginCalls.push(args);
        if(window.holdAction===args.action)await new Promise(resolve=>window.releaseAction=resolve);
        if(window.rejectAction===args.action)throw Error('登录操作测试失败');
        if(args.action==='cancel')window.musicState.login={phase:'',qr:null,message:''};
        else if(args.action==='logout'){window.musicState.account=null;window.musicState.login={phase:'',qr:null,message:''};}
        else if(args.action==='refresh-account')window.musicState.account.nickname='已刷新账号';
        else window.musicState.login={provider:args.provider,phase:'waiting',qr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',message:'等待扫码确认'};
        return;
      }
      if(command==='music_browse')return null;
      if(command==='music_library_data')return {items:[],total:0,complete:true,nextOffset:null};
      if(command==='music_playlists')return {items:[],total:0,nextOffset:null,filtered:0};
      return null;
    }};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(MusicProvider,null,React.createElement('div',{style:{height:'100dvh',display:'flex'}},React.createElement(MusicLibrary)))));
  ` }));
  await page.goto('/#music');
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeEnabled();
}

test('music failures use dismissible messages without moving the library or repeating on polls', async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate(() => {
    (window as any).musicState.account={provider:'kugou',nickname:'示例账号',avatar:null,membership:null};
  });
  await expect(page.getByRole('button',{name:'账号菜单'})).toBeVisible();
  const top = (await page.locator('.library-body').boundingBox())!.y;
  for (const [kind, text] of [
    ['permission','酷狗未授权此版本的完整播放，请检查会员、购买权限或版权状态'],
    ['unavailable','酷狗未返回支持的官方音频服务器'],
    ['protected','该音源受保护，暂不支持内置播放'],
  ]) {
    await page.evaluate(({kind,text}) => {
      const p=(window as any).musicState.playback;
      p.generation++; p.phase='error'; p.error=`[${kind}] ${text}`;
      p.failure={kind,retryable:false,loginRequired:false};
    }, {kind,text});
    const message=page.getByRole('alert');
    await expect(message).toContainText(text);
    await expect(message).not.toContainText(`[${kind}]`);
    await expect(page.locator('.error-banner')).toHaveCount(0);
    expect((await page.locator('.library-body').boundingBox())!.y).toBe(top);
    await expect(page.getByRole('button',{name:'重试播放',exact:true})).toHaveCount(0);
    if(kind==='unavailable') await page.screenshot({path:'artifacts/music-message.png'});
    await page.getByRole('button',{name:'关闭提示'}).click();
    await expect(message).toHaveCount(0);
  }
  // Let several ordinary snapshots arrive after dismissal.
  await page.waitForTimeout(1400);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('messages expire and a later playback failure can notify again', async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate(() => {
    const state=(window as any).musicState;
    state.account={provider:'qq',nickname:'示例账号',avatar:null,membership:null};
    state.playback.error='[network] 音频连接失败';
    state.playback.failure={kind:'network',retryable:true,loginRequired:false};
    state.playback.queue=[{id:'123',provider:'qq',title:'示例曲目',artist:'歌手',album:'',cover:null,duration:180,paid:false}];
  });
  await expect(page.getByRole('alert')).toContainText('音频连接失败');
  await expect(page.getByRole('button',{name:'重试播放',exact:true})).toBeVisible();
  await page.mouse.move(0,0);
  await expect(page.getByRole('alert')).toHaveCount(0,{timeout:8000});
  await page.waitForTimeout(1400);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { (window as any).musicState.playback.generation++; });
  await expect(page.getByRole('alert')).toContainText('音频连接失败');
});

for (const [provider, name] of [['qq', 'QQ 音乐'], ['netease', '网易云音乐'], ['kugou', '酷狗音乐']]) {
  test(`${provider} official login can start directly and completes without a second click`, async ({page}) => {
    await loginControlsFixture(page);
    await page.getByRole('button', {name:name+' 可连接', exact:true}).click();
    await page.getByRole('button', {name:'打开官方授权', exact:true}).click();
    await expect(page.getByRole('img', {name:name+'登录二维码'})).toBeVisible();
    await expect(page.locator('.library-login-notice')).toContainText(provider==='kugou'?'刷新二维码':'完成后会自动连接');
    await page.evaluate((provider) => {
      const state=(window as any).musicState;
      state.login={provider,phase:'scanned',qr:null,message:'扫码成功，请在手机上确认'};
    }, provider);
    await expect(page.getByRole('status').filter({hasText:'扫码成功'})).toBeVisible();
    await page.evaluate((provider) => {
      const state=(window as any).musicState;
      state.account={provider,nickname:'登录测试账号',avatar:null,membership:null};
      state.login={provider,phase:'connected',qr:null,message:'已连接'};
    }, provider);
    await expect(page.getByRole('button', {name:'账号菜单'})).toBeVisible();
    expect(await page.evaluate(() => (window as any).loginCalls)).toEqual([{action:'official',provider}]);
  });
}

test('login actions show progress, reject repeated clicks, and recover from command errors', async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate(() => { (window as any).holdAction='start'; });
  await page.getByRole('button', {name:'获取登录二维码'}).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole('button', {name:'正在获取…',exact:true})).toBeDisabled();
  await expect(page.getByRole('button', {name:'打开官方授权',exact:true})).toBeDisabled();
  expect(await page.evaluate(() => (window as any).loginCalls.length)).toBe(1);
  await page.evaluate(() => { (window as any).rejectAction='start'; (window as any).releaseAction(); });
  await expect(page.getByRole('alert')).toContainText('登录操作测试失败');
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeEnabled();
  await page.evaluate(() => { (window as any).holdAction=null; (window as any).rejectAction=null; });
  await page.getByRole('button', {name:'获取登录二维码'}).click();
  await expect(page.getByRole('img', {name:'QQ 音乐登录二维码'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const phase of ['restoring', 'verifying']) test(`${phase} login remains cancellable and never leaves a permanent spinner`, async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate((phase) => { (window as any).musicState.login={provider:'netease',phase,qr:null,message:'正在验证账号'}; }, phase);
  await expect(page.getByRole('button', {name:'网易云音乐 可连接',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button', {name:phase==='restoring'?'正在恢复登录…':'正在连接账号…',exact:true})).toBeDisabled();
  await page.getByRole('button', {name:'取消',exact:true}).click();
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeEnabled();
  await expect(page.getByRole('button', {name:'网易云音乐 可连接',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(() => (window as any).loginCalls)).toEqual([{action:'cancel',provider:'netease'}]);
});

test('authorization has working open, refresh and cancel actions without a false loading spinner', async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate(() => { (window as any).musicState.login={provider:'netease',phase:'authorization',qr:null,message:'需要额外验证，请打开官方授权窗口完成'}; });
  await expect(page.getByRole('status')).toContainText('需要额外验证');
  await expect(page.locator('.library-qr .spinning')).toHaveCount(0);
  await page.getByRole('button', {name:'打开官方授权',exact:true}).click();
  await expect(page.getByRole('img', {name:'网易云音乐登录二维码'})).toBeVisible();
  await page.evaluate(() => { (window as any).musicState.login.phase='expired'; });
  await page.getByRole('button', {name:'刷新二维码',exact:true}).click();
  await expect(page.getByRole('img', {name:'网易云音乐登录二维码'})).toBeVisible();
  await page.getByRole('button', {name:'取消',exact:true}).click();
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeEnabled();
  expect(await page.evaluate(() => (window as any).loginCalls.map((c: any)=>c.action))).toEqual(['official','start','cancel']);
});

test('an incoming native login takes priority over a previous platform selection', async ({page}) => {
  await loginControlsFixture(page);
  await page.getByRole('button', {name:'网易云音乐 可连接',exact:true}).click();
  await page.getByRole('button', {name:'QQ 音乐 可连接',exact:true}).click();
  await page.evaluate(() => { (window as any).musicState.login={provider:'netease',phase:'waiting',qr:null,message:'网易登录已开始'}; });
  await expect(page.getByRole('button', {name:'网易云音乐 可连接',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', {name:'取消',exact:true}).click();
  expect(await page.evaluate(() => (window as any).loginCalls)).toEqual([{action:'cancel',provider:'netease'}]);
});

test('reauthentication replaces the library until cancelled or connected, and account buttons target that provider', async ({page}) => {
  await loginControlsFixture(page);
  await page.evaluate(() => {
    const state=(window as any).musicState;
    state.account={provider:'netease',nickname:'原账号',avatar:null,membership:null};
    state.playback.error='登录已过期';state.playback.failure={kind:'authentication',loginRequired:true,retryable:false};
  });
  await expect(page.getByRole('button', {name:'账号菜单'})).toBeVisible();
  await page.getByRole('button', {name:'重新扫码',exact:true}).click();
  await expect(page.getByRole('img', {name:'网易云音乐登录二维码'})).toBeVisible();
  await expect(page.getByRole('button', {name:'账号菜单'})).toHaveCount(0);
  await page.getByRole('button', {name:'取消',exact:true}).click();
  await expect(page.getByRole('button', {name:'账号菜单'})).toContainText('原账号');
  await page.evaluate(() => { (window as any).musicState.playback.error=null; });
  await page.getByRole('button', {name:'账号菜单'}).click();
  await page.getByRole('menuitem', {name:'刷新账号',exact:true}).click();
  await expect(page.getByRole('button', {name:'账号菜单'})).toContainText('已刷新账号');
  await page.getByRole('button', {name:'账号菜单'}).click();
  await page.getByRole('menuitem', {name:'退出登录',exact:true}).click();
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeEnabled();
  expect(await page.evaluate(() => (window as any).loginCalls)).toEqual(['start','cancel','refresh-account','logout'].map(action=>({action,provider:'netease'})));
});

async function loginSessionFixture(page: Page) {
  await page.addInitScript(() => { window.isTauri = true; });
  await page.route("**/src/main.tsx*", route => route.fulfill({
    contentType: "text/javascript",
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {MusicLibrary} from '/src/features/music/music-library.tsx';
      import {MusicProvider} from '/src/features/music/use-music.ts';
      import {emptySnapshot} from '/src/features/music/types.ts';
      import '/src/index.css';
      window.musicState=structuredClone(emptySnapshot);
      window.musicState.providers=[{id:'netease',name:'网易云音乐',capabilities:['qr-login','playlists','playback']}];
      window.loginCalls=[];
      window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
        if(command==='music_snapshot'){
          const value=structuredClone(window.musicState);
          if(window.holdNextSnapshot){
            window.holdNextSnapshot=false;
            return new Promise(resolve=>{window.releaseOldSnapshot=()=>resolve(value);window.snapshotHeld=true});
          }
          return value;
        }
        if(command==='music_login'){
          window.loginCalls.push(args.action);
          window.musicState.login={provider:'netease',phase:'waiting',qr:null,message:'等待网易云扫码确认'};
          return;
        }
        if(command==='music_browse')return null;
        if(command==='music_library_data')return {items:[],total:0,synced:0,complete:true,updated:0};
        if(command==='music_playlists')return {items:[],total:0,nextOffset:null,filtered:0};
        return null;
      }};
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement(React.StrictMode,null,React.createElement(MusicProvider,null,
          React.createElement('div',{style:{height:'100vh',display:'flex'}},React.createElement(MusicLibrary)))));
    `,
  }));
  await page.goto('/#music');
  await expect(page.getByRole('button', {name:'获取登录二维码'})).toBeVisible();
}

test('NetEase login updates automatically after a stalled status request and ignores its late response', async ({page}) => {
  await loginSessionFixture(page);
  await page.getByRole('button', {name:'获取登录二维码'}).click();
  await expect(page.getByText('等待网易云扫码确认', {exact:true})).toBeVisible();
  await page.evaluate(() => { (window as any).holdNextSnapshot = true; });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).snapshotHeld))).toBe(true);
  await page.evaluate(() => {
    (window as any).musicState.login = {provider:'netease',phase:'verifying',qr:null,message:'正在验证网易云音乐账号…'};
  });
  await expect(page.getByText('正在验证网易云音乐账号…', {exact:true})).toBeVisible({timeout:9000});
  await page.evaluate(() => {
    const state = (window as any).musicState;
    state.account = {provider:'netease',nickname:'网易测试账号',avatar:null,membership:{active:true,name:'黑胶 VIP',level:5,expires:null},membershipIssue:null};
    state.login = {provider:'netease',phase:'connected',qr:null,message:'网易云音乐已连接'};
  });
  await expect(page.getByRole('button', {name:'账号菜单'})).toContainText('黑胶 VIP5');
  await expect(page.getByText('连接你的音乐', {exact:true})).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseOldSnapshot());
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', {name:'账号菜单'})).toBeVisible();
  expect(await page.evaluate(() => (window as any).loginCalls)).toEqual(['start']);
});

test('unknown membership is distinct from an explicitly inactive membership', async ({page}) => {
  await loginSessionFixture(page);
  await page.evaluate(() => {
    (window as any).musicState.account = {provider:'netease',nickname:'网易测试账号',avatar:null,membership:null,membershipIssue:'会员信息暂不可用'};
  });
  const menu = page.getByRole('button', {name:'账号菜单'});
  await expect(menu).toContainText('会员状态待确认');
  await expect(menu).not.toContainText('普通用户');
  await page.evaluate(() => {
    const account = (window as any).musicState.account;
    account.membership = {active:false,name:'普通用户',level:0,expires:null};
    account.membershipIssue = null;
  });
  await expect(menu).toContainText('普通用户');
  await expect(menu).not.toContainText('会员状态待确认');
});
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
 if(command==='music_snapshot')return {...structuredClone(emptySnapshot),account:{provider:'qq',nickname:'测试',avatar:null,membership:null},providers:[{id:'qq',name:'QQ 音乐',capabilities:['search','playlists','playback','lyrics']}]};
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
