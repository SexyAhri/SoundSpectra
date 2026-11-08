import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('full expanse reaches all viewport edges through audio changes and resize without rebuilding GPU resources', async ({ page }) => {
  test.setTimeout(120_000)
  await page.routeWebSocket('**', socket => {
    socket.send(JSON.stringify({ type: 'connected' })); socket.onMessage(() => {})
  })
  await page.route('**/expanse-fill-test', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/expanse-fill-test')
  const result = await page.evaluate(async () => {
    const { CompositionStudy } = await import('/src/features/spectrum/three/compositions/study-session.ts')
    const canvas = document.createElement('canvas'); document.body.append(canvas)
    canvas.style.cssText = 'width:640px;height:360px'
    const s = new CompositionStudy(canvas, 'expanse')
    s.settings.quality = 'eco'; s.settings.music.fieldScale = 1.8
    await s.resize(); s.step(1/30)
    const root = s.world.scene.getObjectByName('composition-expanse')!
    const objects = root.children.slice(), geometry = (objects[0] as any).geometry
    const programs = s.world.renderer.info.programs!.slice()
    const rows = []
    for (const [width,height] of [[640,360],[840,360],[480,360]]) for (const mode of ['immersive','daily'] as const) {
      canvas.style.cssText = `width:${width}px;height:${height}px`
      s.settings.sceneMode = mode; await s.resize()
      for (const level of ['quiet','strong'] as const) {
        s.level = level
        s.settings.music.fieldHeight = level === 'strong' ? 1.8 : .3
        for (let frame=0;frame<90;frame++) s.step(1/30)
        const gl = s.world.renderer.getContext(), pixels = new Uint8Array(canvas.width*canvas.height*4)
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        const edge=[0,0,0,0],total=[0,0,0,0]
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
          const visible=pixels[(y*canvas.width+x)*4+3]>8
          const inside=[x<canvas.width*.08,x>canvas.width*.92,y<canvas.height*.08,y>canvas.height*.92]
          for(let k=0;k<4;k++)if(inside[k]){total[k]++;if(visible)edge[k]++}
        }
        rows.push({width,height,mode,level,edge:edge.map((v,i)=>v/total[i]),gl:gl.getError()})
      }
    }
    const reused = root.children.every((object,i)=>object===objects[i]&&(object as any).geometry===geometry)
      && s.world.renderer.info.programs!.length===programs.length
      && programs.every(program=>s.world.renderer.info.programs!.includes(program))
    const remaining=s.dispose();s.world.renderer.forceContextLoss();canvas.remove()
    return {rows,reused,remaining,errors:s.errors}
  })
  for(const row of result.rows){
    expect(row.gl,JSON.stringify(row)).toBe(0)
    for(const coverage of row.edge)expect(coverage,JSON.stringify(row)).toBeGreaterThan(.008)
  }
  expect(result).toMatchObject({reused:true,remaining:{geometries:0,textures:0},errors:[]})
})
