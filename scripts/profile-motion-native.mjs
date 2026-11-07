import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)??'before'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/motion-quality/profile-${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223')
try{
 const main=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420/')&&!p.url().includes('window='))
 if(!main)throw Error('Development main view required')
 const cdp=await main.context().newCDPSession(main)
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
 const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve))
 await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,cc,viz,gpu,benchmark,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'})
 await new Promise(r=>setTimeout(r,6500))
 const {profile}=await cdp.send('Profiler.stop');await cdp.send('Profiler.disable');await cdp.send('Tracing.end')
 const {stream}=await completed;let trace=''
 for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break}await cdp.send('IO.close',{handle:stream})
 await writeFile(`${folder}/cpu.json`,JSON.stringify(profile));await writeFile(`${folder}/trace.json`,trace)
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),counts=new Map()
 profile.samples?.forEach((id,i)=>counts.set(id,(counts.get(id)??0)+(profile.timeDeltas?.[i]??0)))
 const self=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([id,time])=>({ms:time/1000,...nodes.get(id).callFrame}))
 const events=JSON.parse(trace).traceEvents,totals=new Map()
 for(const e of events){if(e.ph==='X')totals.set(e.name,(totals.get(e.name)??0)+(e.dur??0)/1000)}
 const names=[...new Set(events.map(e=>e.name))].filter(n=>/Present|Frame|Draw|GPU|Layout|Paint/.test(n))
 const summary={self,traceDurations:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,35),frameEventNames:names}
 await writeFile(`${folder}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
 await cdp.detach()
}finally{await browser.close()}
