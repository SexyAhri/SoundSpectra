import { chromium } from '@playwright/test'
import { mkdirSync, copyFileSync } from 'node:fs'

const output='artifacts/folded-curtain'
mkdirSync(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:process.argv.includes('--video')?{dir:output,size:{width:1440,height:1000}}:undefined})
  const page=await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.on('console',message=>{if(message.type()==='error')console.error(message.text())})
  await page.goto('http://127.0.0.1:1420/experiments/folded-curtain.html')
  await page.waitForFunction(()=>window.foldStudy?.diagnostics.frames>0)
  if(!process.argv.includes('--video')) {
  for(const [name,time] of [['unfold',1050],['reading',3300],['handoff',6350],['mixed',14000],['long',20500]]) {
    await page.evaluate(time=>window.foldStudy.clock.seek(time),time)
    await page.waitForFunction(time=>window.foldStudy.diagnostics.time===time,time)
    await page.screenshot({path:`${output}/${name}.png`})
  }
  await page.setViewportSize({width:430,height:900})
  await page.screenshot({path:`${output}/narrow.png`})
  await page.setViewportSize({width:1440,height:1000})
  }
  if(process.argv.includes('--video')) {
    await page.evaluate(()=>{window.foldStudy.clock.seek(0);window.foldStudy.clock.play(true)})
    await page.waitForFunction(()=>window.foldStudy.clock.read()===31500,{},{timeout:40000})
    await page.evaluate(()=>{window.foldStudy.setWordTiming(false);window.foldStudy.clock.seek(5700);window.foldStudy.clock.play(true)})
    await page.waitForTimeout(6500)
    await page.evaluate(()=>{window.foldStudy.clock.play(false);window.foldStudy.clock.seek(6350)})
    await page.waitForTimeout(1200)
    await page.evaluate(()=>window.foldStudy.clock.seek(14000))
    await page.waitForTimeout(1200)
    await page.evaluate(()=>window.foldStudy.clock.seek(6350))
    await page.waitForTimeout(1200)
    const video=page.video();await page.close();await context.close();copyFileSync(await video.path(),`${output}/preview.webm`)
  } else await context.close()
} finally {await browser.close()}
