import { expect, test } from '@playwright/test'
import { musicEffects } from '../src/features/spectrum/music-engine/catalog'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('the workspace waits for music by default and simulation requires an explicit opt-in',async({page})=>{
  await page.goto('/#scene')
  const demo=page.getByRole('switch',{name:'模拟预览',exact:true}),canvas=page.locator('.three-scene-surface canvas').first()
  await expect(demo).not.toBeChecked()
  await expect(canvas).toHaveAttribute('data-transporting','false')
  await expect(page.getByText('等待音乐播放',{exact:true})).toBeVisible()
  await demo.check()
  await expect(canvas).toHaveAttribute('data-transporting','true')
  await demo.uncheck()
  await expect(canvas).toHaveAttribute('data-transporting','false')
  await page.reload()
  await expect(demo).not.toBeChecked()
})

for(const {value:effect} of musicEffects){
  test(`${effect}: fresh silence, pauses, noise and a disconnected source stop GPU draws; music resumes`,async({page},testInfo)=>{
    test.setTimeout(60_000)
    const errors:string[]=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.routeWebSocket('**/*',()=>{})
    await page.route('**/music-driven-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0;background:#10151b"><div class="app-shell"></div></body>')}))
    await page.goto('/music-driven-probe')
    await page.evaluate(async effect=>{
      const [{mountSoundFieldProbe},{recommendedMusic}]=await Promise.all([
        import('/tests/fixtures/sound-field-probe.tsx'),import('/src/features/spectrum/effect-presets.ts'),
      ])
      const probe=mountSoundFieldProbe({effect,music:recommendedMusic(effect),quality:'eco',sceneMode:'immersive',opacity:100})
      document.getElementById('sound-field-probe')!.style.cssText='width:480px;height:270px;background:#10151b'
      const state=(window as any).musicDriveProbe={probe,rms:0,connected:true,timer:0,sequence:0}
      state.timer=window.setInterval(()=>{
        if(!state.connected)return
        probe.push({rms:state.rms,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[],
          sourceRevision:1,streamId:1,sequence:++state.sequence,samplePosition:state.sequence*1024,sampleRate:48000})
      },22)
    },effect)
    const canvas=page.locator('#sound-field-probe canvas')
    const set=(rms:number,connected=true)=>page.evaluate(({rms,connected})=>Object.assign((window as any).musicDriveProbe,{rms,connected}),{rms,connected})
    const idle=async()=>{
      await expect(canvas).toHaveAttribute('data-transporting','false')
      await expect(canvas).toHaveAttribute('data-preparing','false')
      await expect(canvas).toHaveAttribute('data-resize-paused','false')
      const delta=await canvas.evaluate(async (c:HTMLCanvasElement)=>{
        const frames=Number(c.dataset.frames)
        await new Promise(resolve=>setTimeout(resolve,450))
        return Number(c.dataset.frames)-frames
      })
      expect(delta).toBe(0)
    }
    await idle()
    await set(.15)
    await expect(canvas).toHaveAttribute('data-transporting','true')
    const first=Number(await canvas.getAttribute('data-frames'))
    await expect.poll(()=>canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(first+3)
    if(['rhythm_balls','ginkgo_leaves','butterfly_flock','ripple'].includes(effect))
      await canvas.screenshot({path:testInfo.outputPath('playing.png')})
    await set(0);await idle()
    await set(.0001);await idle()
    await set(.15)
    await expect(canvas).toHaveAttribute('data-transporting','true')
    await set(.15,false);await idle()
    await page.evaluate(()=>{const state=(window as any).musicDriveProbe;clearInterval(state.timer);state.probe.dispose()})
    expect(errors).toEqual([])
  })
}
