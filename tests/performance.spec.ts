import { test,expect } from '@playwright/test'
import { applyShow, exampleShow, parsePerformance, emptyPerformance, showState, visualSnapshot } from '../src/features/performance/model'
import { mappingValues } from '../src/features/performance/mapping'
import { SceneTransition, transitionCompatibility } from '../src/features/performance/transition'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { defaults } from '../src/features/spectrum/model'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('absolute-time reconstruction handles palette ordering, camera seek, loops and base edits without mutating snapshots',()=>{
  const show=exampleShow(),base=structuredClone(defaults),before=JSON.stringify(show)
  const a=applyShow(base,showState(show,12500));expect(a.effect).toBe('layered_tides');expect(a.music.fieldPalette).toBe('ember')
  const moving=applyShow(base,showState(show,21500));expect(moving.effect).toBe('echo_corridor');expect(moving.view.yaw).toBeCloseTo(12)
  expect(applyShow(base,showState(show,24500)).view.yaw).toBe(0)
  expect(applyShow(base,showState(show,21500,true)).view.yaw).toBe(0)
  expect(applyShow(base,showState(show,1000)).effect).toBe('tidal_knot')
  expect(applyShow({...base,lyrics:{...base.lyrics,fontSize:77}},showState(show,27000)).lyrics.fontSize).toBe(77)
  expect(JSON.stringify(show)).toBe(before);expect(base).toEqual(defaults)
  const scene=show.cues[0];show.cues=[scene,{id:'same',timeMs:0,action:{type:'palette',palette:'lake'}}];expect(showState(show,0).palette).toBe('lake')
  show.cues.reverse();expect(showState(show,0).palette).toBeUndefined()
})
test('imports validate all cues before applying and preserve version-one scene data',()=>{
  const show=exampleShow(),v={...emptyPerformance,shows:[show],selected:show.id};expect(parsePerformance(v)).toEqual(v)
  for(const invalid of [NaN,-1,86400001]){const next=structuredClone(v);next.shows[0].cues[0].timeMs=invalid;expect(()=>parsePerformance(next)).toThrow()}
  const bad=structuredClone(v);(bad.shows[0].cues[0].action as any).snapshot.music.fieldHeight=999;expect(()=>parsePerformance(bad)).toThrow()
  expect(visualSnapshot(defaults)).not.toHaveProperty('lyrics')
})
test('mapping keeps physical-band semantics, bounded output and silence/reduced-motion reset',()=>{
  const motion=new SceneMotion();motion.transporting=true;motion.frame={audible:true,bandRms:[.11,.11,.02,.02,.01,.01],transients:[.7,.2,0]} as any
  const map={preset:'bend' as const,source:'bass' as const,target:'bend' as const,amount:1,curve:'linear' as const}
  expect(mappingValues('tidal_knot',map,motion,false)).toEqual({bend:.5,unfold:0})
  expect(mappingValues('tidal_knot',{...map,target:'unfold'},motion,false)).toEqual({bend:0,unfold:.5})
  expect(mappingValues('tidal_knot',map,motion,true)).toEqual({bend:0,unfold:0})
  expect(mappingValues('ripple',map,motion,false)).toEqual({bend:0,unfold:0})
  motion.transporting=false;expect(mappingValues('tidal_knot',map,motion,false)).toEqual({bend:0,unfold:0})
})
test('rapid A-B-C changes retain one scene, compatible routes and bounded progress while preparation waits',()=>{
  const a={...defaults,effect:'tidal_knot' as const},b={...defaults,effect:'layered_tides' as const},c={...defaults,effect:'echo_corridor' as const},t=new SceneTransition();let captures=0,current=a as typeof defaults
  const step=(next:typeof defaults,ready=true)=>current=t.step(current,next,{kind:'particles',durationMs:1000},true,false,.1,ready,()=>captures++)
  for(let i=0;i<3;i++)step(b)
  expect(t.frame.scatter).toBeGreaterThan(0);step(c,false)
  expect(current.effect).toBe(c.effect);expect(t.frame.kind).toBe('dissolve');expect(t.frame.blend).toBe(0)
  for(let i=0;i<30;i++)step(c,false);expect(t.frame.blend).toBe(0)
  for(let i=0;i<20;i++)step(c,true);expect(t.active).toBe(false);expect(t.frame.blend).toBe(1);expect(captures).toBeGreaterThan(0)
  expect(transitionCompatibility('particles','tidal_knot','ripple')).toBe('dissolve')
})
test('production preview plays transitions, reconstructs seeks and provides two mappings without GL errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/tools/performance-lab.html')
  const canvas=page.locator('canvas');await expect(canvas).toHaveAttribute('data-scene','tidal_knot');await expect(canvas).toHaveAttribute('data-preparing','false')
  await page.getByRole('button',{name:'播放预演',exact:true}).click()
  await page.getByLabel('预演播放头').fill('6700')
  await expect(canvas).toHaveAttribute('data-transition','particles',{timeout:15000})
  await expect(canvas).toHaveAttribute('data-scene','layered_tides',{timeout:15000})
  await page.getByRole('button',{name:'暂停预演',exact:true}).click()
  await page.getByLabel('预演播放头').fill('12500');await expect(canvas).toHaveAttribute('data-scene','layered_tides')
  await page.getByLabel('预演播放头').fill('27000');await expect(canvas).toHaveAttribute('data-scene','star_flight')
  await page.getByLabel('预演播放头').fill('1000');await expect(canvas).toHaveAttribute('data-scene','tidal_knot')
  await page.getByRole('button',{name:'同输入 · 映射对照'}).click();await expect(page.locator('canvas')).toHaveCount(2)
  await expect.poll(async()=>page.locator('canvas').evaluateAll(nodes=>nodes.map(c=>JSON.parse((c as HTMLCanvasElement).dataset.mapping??'{}')))).toEqual([expect.objectContaining({bend:expect.any(Number),unfold:0}),expect.objectContaining({bend:0,unfold:expect.any(Number)})])
  await expect.poll(async()=>page.locator('canvas').evaluateAll(nodes=>{const m=nodes.map(c=>JSON.parse((c as HTMLCanvasElement).dataset.mapping??'{}'));return m[0]?.bend>0&&m[1]?.unfold>0})).toBe(true)
  expect(errors).toEqual([])
})

test('crossfade preserves linear premultiplied energy, applies current masks and releases snapshot resources',async({page})=>{
  await page.route('**/performance-output',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}));await page.goto('/performance-output')
  const result=await page.evaluate(async()=>{
    const T=await import('/node_modules/.vite/deps/three.js'),{TransitionOutput}=await import('/src/features/spectrum/three/r3f/transition-output.ts')
    const canvas=document.createElement('canvas'),gl=new T.WebGLRenderer({canvas,alpha:true,premultipliedAlpha:true});gl.setSize(16,16);document.body.append(canvas)
    const output=new TransitionOutput();output.resize(16,16)
    const u={uRegion:{value:new T.Vector4(0,0,1,1)},uMasks:{value:Array.from({length:8},()=>new T.Vector4(0,0,1,1))},uFeather:{value:new Float32Array(8)},uMaskCount:{value:0},uFocusBounds:{value:new T.Vector4()},uFocusActive:{value:0}}
    const context=gl.getContext(),pixels=new Uint8Array(4),fill=(r:number,g:number,b:number,a:number)=>{gl.setRenderTarget(output.live);context.clearColor(Math.sqrt(r),Math.sqrt(g),Math.sqrt(b),a);context.clear(context.COLOR_BUFFER_BIT)}
    const read=(target:any)=>{const p=new Uint8Array(4);gl.readRenderTargetPixels(target,8,8,1,1,p);return [...p]}
    fill(.2,.1,.05,.5);const sourceA=read(output.live);output.draw(gl,undefined,u);const first=read((output as any).output);output.capture(gl);const history=read((output as any).history)
    fill(.05,.1,.2,.5);const sourceB=read(output.live);output.draw(gl,{blend:.5,scatter:0,travel:0,kind:'dissolve'},u);const linear=read((output as any).output);context.readPixels(8,8,1,1,context.RGBA,context.UNSIGNED_BYTE,pixels);const blend=[...pixels]
    fill(0,0,0,0);u.uMaskCount.value=1;output.draw(gl,{blend:0,scatter:0,travel:0,kind:'dissolve'},u);context.readPixels(8,8,1,1,context.RGBA,context.UNSIGNED_BYTE,pixels);const masked=[...pixels]
    output.dispose();const remaining={...gl.info.memory};const error=context.getError();gl.dispose();gl.forceContextLoss();canvas.remove();return{blend,sourceA,sourceB,first,history,linear,masked,remaining,error}
  })
  // linear RGB .25/.20/.25, converted to sRGB once, then premultiplied by alpha .5.
  for(const [i,value] of [69,62,69,128].entries())expect(Math.abs(result.blend[i]-value),JSON.stringify(result)).toBeLessThanOrEqual(2)
  expect(result.masked).toEqual([0,0,0,0]);expect(result.remaining).toMatchObject({geometries:0,textures:0});expect(result.error).toBe(0)
})

test('player clock loss, track changes, manual overrides and failed saves never persist runtime state',async({page})=>{
  await page.goto('/tools/performance-lab.html')
  const result=await page.evaluate(async()=>{
    const {PerformanceFrame,savePerformance,readPerformance}=await import('/src/features/performance/runtime.tsx')
    const {exampleShow,emptyPerformance,recordingKey}=await import('/src/features/performance/model.ts')
    const {defaults}=await import('/src/features/spectrum/model.ts'),{emptyNowPlaying}=await import('/src/features/desktop-card/use-now-playing.ts')
    const show=exampleShow(),info={...emptyNowPlaying,title:'Fixture recording',artist:'SoundSpectra',source:'fixture-player',trackId:'recording-001',sessionId:'session-01',duration:36,position:12.5,updated:Date.now(),timelineAvailable:true}
    show.track=recordingKey(info);const config={...emptyPerformance,shows:[show],selected:show.id},base=structuredClone(defaults),frame=new PerformanceFrame()
    const controller={config,info:{current:info},session:{showId:show.id,track:show.track!,playerSession:info.sessionId},arm:()=>{}}
    const start=frame.resolve(controller,base,'primary',false).settings
    const edited={...base,color:'#123456',view:{...base.view,yaw:17},lyrics:{...base.lyrics,fontSize:72}}
    const manual=frame.resolve(controller,edited,'primary',false).settings
    controller.info.current={...info,position:21.5,updated:Date.now()};const camera=frame.resolve(controller,edited,'primary',false).settings
    controller.info.current={...info,position:24.5,updated:Date.now()};const settled=frame.resolve(controller,edited,'primary',false).settings
    controller.info.current={...info,updated:Date.now()-5000};const stale=frame.resolve(controller,edited,'primary',false).settings
    controller.info.current={...info,trackId:'recording-002'};const changed=frame.resolve(controller,edited,'primary',false).settings
    savePerformance(config);const before=JSON.stringify(readPerformance()),set=Storage.prototype.setItem;let failed=false
    try{Storage.prototype.setItem=()=>{throw Error('quota fixture')};try{savePerformance({...config,selected:'',shows:[]})}catch{failed=true}}
    finally{Storage.prototype.setItem=set}
    return {start:{effect:start.effect,palette:start.music.fieldPalette},manual:{color:manual.color,yaw:manual.view.yaw,fontSize:manual.lyrics.fontSize},camera:camera.view.yaw,settled:settled.view.yaw,stale:stale===edited,changed:changed===edited,failed,atomic:before===JSON.stringify(readPerformance()),saved:localStorage.getItem('soundspectra.performance.v1')}
  })
  expect(result.start).toEqual({effect:'layered_tides',palette:'ember'});expect(result.manual).toEqual({color:'#123456',yaw:17,fontSize:72})
  expect(result.camera).toBe(12);expect(result.settled).toBe(0);expect(result).toMatchObject({stale:true,changed:true,failed:true,atomic:true});expect(result.saved).not.toContain('session-01')
})

test('a target compilation error restores the previous scene and supports subsequent switching',async({page})=>{
  await page.route('**/performance-fallback',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}));await page.goto('/performance-fallback')
  const result=await page.evaluate(async()=>{
    const {FiberSceneRenderer}=await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),{SceneMotion}=await import('/src/features/spectrum/three/motion.ts'),{defaults}=await import('/src/features/spectrum/model.ts')
    const canvas=document.createElement('canvas');canvas.style.cssText='width:256px;height:144px';document.body.append(canvas)
    const errors:string[]=[],world=new FiberSceneRenderer(canvas,e=>errors.push(String(e))),motion=new SceneMotion()
    const a={...defaults,effect:'tidal_knot' as const,quality:'eco' as const},b={...a,effect:'echo_corridor' as const},c={...a,effect:'layered_tides' as const}
    await world.resize(a,1);world.draw(motion,a,false)
    const compile=world.renderer.compileAsync.bind(world.renderer);let injected=false
    world.renderer.compileAsync=(scene,...args)=>{if(!injected&&scene.getObjectByName('composition-passage')){injected=true;return Promise.reject(Error('target compilation fixture'))}return compile(scene,...args)}
    world.draw(motion,b,false)
    for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,10));world.draw(motion,b,false);if(canvas.dataset.transitionError&&canvas.dataset.scene==='tidal_knot'&&canvas.dataset.preparing==='false')break}
    const fallback=canvas.dataset.scene,notice=canvas.dataset.transitionError
    for(let i=0;i<120;i++){world.draw(motion,c,false,.1);await new Promise(r=>setTimeout(r,10));if(canvas.dataset.scene==='layered_tides'&&canvas.dataset.transition==='idle')break}
    const target=canvas.dataset.scene,error=world.renderer.getContext().getError();world.dispose();world.renderer.forceContextLoss();canvas.remove();return {injected,fallback,notice,target,error,errors}
  })
  expect(result).toMatchObject({injected:true,fallback:'tidal_knot',target:'layered_tides',error:0,errors:[]});expect(result.notice).toContain('target compilation fixture')
})

test('workbench controls create, edit, remove and reload time markers without JSON authoring',async({page})=>{
  await page.goto('/tools/performance-lab.html');await page.getByRole('button',{name:'演出编排',exact:true}).click()
  await page.getByRole('button',{name:'载入原创示例',exact:true}).click();await expect(page.getByLabel('选择演出')).toBeVisible()
  await page.getByLabel('标记 1 时间（秒）',{exact:true}).fill('0.5')
  await page.getByText('添加时间标记', { exact: true }).click()
  await page.getByLabel('新标记时间',{exact:true}).fill('39');await page.getByLabel('新标记动作').click();await page.getByRole('option',{name:'一次受控运镜',exact:true}).click();await page.getByRole('button',{name:'新增标记',exact:true}).click()
  await expect(page.getByLabel('标记 8 时间（秒）',{exact:true})).toHaveValue('39')
  await page.getByRole('button',{name:'删除标记 8',exact:true}).click();await expect(page.getByLabel('标记 8 时间（秒）',{exact:true})).toHaveCount(0)
  await page.reload();await page.getByRole('button',{name:'演出编排',exact:true}).click();await expect(page.getByLabel('标记 1 时间（秒）',{exact:true})).toHaveValue('0.5')
  await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'关闭演出编排',exact:true}).click()
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.performance.v1')!).shows[0].cues.length)).toBe(7)
})
