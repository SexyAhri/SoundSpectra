import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'
import { expect,test } from '@playwright/test'
import { defaults,normalizeSettings } from '../src/features/spectrum/model'
import { displayBounds } from '../src/features/spectrum/regions'
import { depthAt } from '../src/features/wallpaper-depth/depth-field'

test('wallpaper parallax defaults off, validates settings and gives foreground more depth',()=>{
 expect(normalizeSettings({}).wallpaperDepth).toEqual({enabled:false,amount:25,profile:'landscape',revision:''})
 expect(normalizeSettings({wallpaperDepth:{enabled:true,amount:Infinity,profile:'unknown',revision:'../image'}}).wallpaperDepth).toEqual({enabled:true,amount:25,profile:'landscape',revision:''})
 const settings=normalizeSettings({...defaults,wallpaperDepth:{enabled:true,amount:25,profile:'left-foreground',revision:'abcdef'}})
 expect(displayBounds(settings)).toEqual({x:0,y:0,width:1,height:1})
 expect(depthAt(.25,.4,'left-foreground')).toBeGreaterThan(depthAt(.8,.4,'left-foreground')+.3)
 expect(depthAt(.8,.95,'landscape')).toBeGreaterThan(depthAt(.8,.15,'landscape')+.5)
})

test('imported wallpaper previews parallax, preserves settings, reloads and can be disabled',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/')
 await page.getByRole('button',{name:'壁纸',exact:true}).click()
 await expect(page.getByRole('switch',{name:'立体壁纸',exact:true})).toBeDisabled()
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d')!;const sky=ctx.createLinearGradient(0,0,0,540);sky.addColorStop(0,'#537a85');sky.addColorStop(1,'#bfa379');ctx.fillStyle=sky;ctx.fillRect(0,0,960,540);ctx.fillStyle='#725847';ctx.fillRect(0,120,350,420);ctx.fillStyle='#323e32';for(let x=0;x<960;x+=45)ctx.fillRect(x,450+x%60,25,90);return c.toDataURL('image/png').split(',')[1]})
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')??'null'))
 await page.getByLabel('立体壁纸图片文件').setInputFiles({name:'landscape.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')})
 await expect(page.getByRole('switch',{name:'立体壁纸',exact:true})).toHaveAttribute('aria-checked','true')
 const layer=page.getByTestId('depth-wallpaper')
 await expect(layer).toHaveAttribute('data-ready','true')
 const canvas=layer.locator('canvas'),stage=page.locator('.desktop-preview'),box=await stage.boundingBox()
 expect(box).not.toBeNull()
 await page.mouse.move(box!.x+box!.width*.85,box!.y+box!.height*.7)
 await expect.poll(()=>canvas.getAttribute('data-camera')).not.toBe('0.0000,0.0000')
 await page.getByRole('slider',{name:'壁纸视差强度',exact:true}).focus();await page.keyboard.press('ArrowRight')
 await expect(page.getByText('已保存到此浏览器',{exact:true})).toBeVisible()
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
 expect(saved.wallpaperDepth).toMatchObject({enabled:true,amount:26,profile:'landscape'})
 if(before){expect(saved.effect).toBe(before.effect);expect(saved.music).toEqual(before.music)}
 await page.reload();await expect(layer).toHaveAttribute('data-ready','true')
 await page.getByRole('switch',{name:'立体壁纸',exact:true}).click();await expect(layer).toHaveCount(0)
 await page.reload();await expect(page.getByRole('switch',{name:'立体壁纸',exact:true})).toHaveAttribute('aria-checked','false')
 expect(errors).toEqual([])
})

test('wallpaper file failure stays visible and reduced motion holds the camera still',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto('/')
 await page.getByRole('button',{name:'壁纸',exact:true}).click()
 await page.getByLabel('立体壁纸图片文件').setInputFiles({name:'invalid.jpg',mimeType:'image/jpeg',buffer:Buffer.from('invalid image')})
 await expect(page.getByRole('alert').filter({hasText:'无法读取立体壁纸'})).toBeVisible()
 await expect(page.getByRole('switch',{name:'立体壁纸',exact:true})).toHaveAttribute('aria-checked','false')
})

test('snow uses a transparent scene and preserves the wallpaper under silent and active audio',async({page})=>{
 await page.route('**/snow-probe',route=>route.fulfill({contentType:'text/html',body: visualProbeHtml('<body style="margin:0"></body>')}))
 await page.goto('/snow-probe')
 const result=await page.evaluate(async()=>{
   const {ClassicSceneRenderer}=await import('/src/features/spectrum/three/classic/classic-renderer.ts')
   const {SceneMotion}=await import('/src/features/spectrum/three/motion.ts')
   const {defaults}=await import('/src/features/spectrum/model.ts')
   const {demoAnalysis}=await import('/src/features/spectrum/music-analysis.ts')
   const c=document.createElement('canvas');c.style.cssText='width:640px;height:360px';document.body.append(c)
   const config={...defaults,effect:'ripple' as const,sceneMode:'immersive' as const},world=new ClassicSceneRenderer(c),motion=new SceneMotion()
   try{await world.resize(config,1);for(let i=0;i<60;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
     const gl=world.renderer.getContext(),data=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,data)
     let clear=0,flakes=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)clear++;if(data[i]>8)flakes++}
     return {clear:clear/(c.width*c.height),flakes,error:gl.getError()}
   }finally{world.dispose();world.renderer.forceContextLoss();c.remove()}
 })
 expect(result.clear).toBeGreaterThan(.80);expect(result.flakes).toBeGreaterThan(50);expect(result.error).toBe(0)
})
