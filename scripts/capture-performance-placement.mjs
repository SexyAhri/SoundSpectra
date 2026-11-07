import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
const folder='artifacts/performance-placement';await mkdir(folder,{recursive:true})
const server=await createServer({configFile:'vite.config.ts',cacheDir:`${folder}/vite-cache`,server:{host:'127.0.0.1',port:1437,strictPort:true,hmr:false,watch:null}})
await server.listen()
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try{
  const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>localStorage.setItem('soundspectra.settings.v1',JSON.stringify({version:1,effect:'tidal_knot',quality:'eco',sceneMode:'immersive',opacity:90,bounds:{x:0,y:0,width:1,height:1}})))
  await page.goto('http://127.0.0.1:1437/')
  await page.getByText('已保存到此浏览器',{exact:true}).waitFor()
  await page.locator('canvas[data-preparing=false]').first().waitFor()
  await page.screenshot({path:`${folder}/workspace.png`})
  await page.getByRole('tab',{name:'外观',exact:true}).click()
  await page.screenshot({path:`${folder}/mapping.png`})
  await page.getByRole('button',{name:'演出编排',exact:true}).click()
  await page.getByRole('button',{name:'载入原创示例',exact:true}).click()
  await page.getByRole('dialog').locator('canvas[data-preparing=false]').waitFor()
  await page.screenshot({path:`${folder}/score.png`})
  await page.getByText('时间编排怎么用？',{exact:true}).click()
  await page.screenshot({path:`${folder}/guide.png`})
  await page.getByText('时间编排怎么用？',{exact:true}).click()
  const geometry=await page.evaluate(()=>{const r=document.querySelector('.performance-workspace').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
  await page.getByRole('tab',{name:'切换转场',exact:true}).click()
  await page.screenshot({path:`${folder}/transitions.png`})
  await page.getByRole('tab',{name:'时间编排',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:`${folder}/mobile.png`})
  await writeFile(`${folder}/report.json`,JSON.stringify({errors,geometry,source:'Isolated browser fixture, 1440x940 and 390x844. No native configuration changed.'},null,2))
  if(errors.length)throw Error(errors.join('\n'))
}finally{await browser.close();await server.close()}
