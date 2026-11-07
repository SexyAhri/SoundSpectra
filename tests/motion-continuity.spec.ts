import { expect, test } from '@playwright/test'
import { AudioFeatureTimeline } from '../src/features/spectrum/audio-feature-timeline'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { defaults } from '../src/features/spectrum/model'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { commonUniforms, flowDriver } from '../src/features/spectrum/three/classic/flow/shared'

const packet=(sequence:number)=>({sourceRevision:1,streamId:1,sequence,samplePosition:sequence*1024,sampleRate:48000,
 rms:.14,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[]})

test('an early packet after late delivery cannot reverse the displayed clock or reset a moving scene',()=>{
 const timeline=new AudioFeatureTimeline(),motion=new SceneMotion(),u=commonUniforms(),drive=flowDriver(u)
 const curve:{wall:number;clock:number;phase:number;level:number}[]=[]
 let next=0
 for(let wall=14;wall<2000;wall++){
  while(next*1024/48+(next%4===0?14:0)<=wall){timeline.push(packet(next),next*1024/48+(next%4===0?14:0));next++}
  const shared=timeline.sample(wall,defaultMusicSettings)!
  motion.step(packet(next-1),.001,defaultMusicSettings,false,shared);drive(motion,defaults,false)
  curve.push({wall,clock:shared.now,phase:u.uPhase.value,level:shared.levels[2]})
 }
 const reversals=curve.slice(1).filter((p,i)=>p.clock<curve[i].clock)
 const resets=curve.slice(1).filter((p,i)=>p.phase<curve[i].phase)
 expect(reversals,JSON.stringify(reversals.slice(0,4))).toEqual([])
 expect(resets).toEqual([])
})

test('a packet boundary does not replay the start of its previous interpolation segment',()=>{
 const timeline=new AudioFeatureTimeline()
 for(let i=0;i<12;i++)timeline.push({...packet(i),bands:Array(6).fill(i<7?0:.9)},i*1024/48)
 // Next packet arrives early. The old implementation recomputes from the old
 // endpoint even though only part of that segment has been displayed.
 const at=12*1024/48-7
 const before=timeline.sample(at-.001,defaultMusicSettings)!
 timeline.push(packet(12),at)
 const after=timeline.sample(at+.001,defaultMusicSettings)!
 expect(Math.abs(after.levels[2]-before.levels[2])).toBeLessThan(.00001)
 expect(after.now).toBeGreaterThanOrEqual(before.now)
})

test('capture clock drift cannot age fresh attacks out of the music response',()=>{
 const timeline=new AudioFeatureTimeline(),hop=1024/48,ages:number[]=[],pulses:number[]=[]
 let previous=-1
 for(let sequence=0;sequence<1400;sequence++){
  const audio={...packet(sequence),rms:sequence%23<2?.3:.02}
  // Capture and WebView clocks are independent. A small persistent drift must
  // never turn a just-detected onset into an event from seconds ago.
  const wall=sequence*hop*1.01
  timeline.push(audio,wall)
  const frame=timeline.sample(wall,defaultMusicSettings)!
  if(sequence>1000&&frame.beatIndex!==previous){ages.push(frame.beatAge);pulses.push(frame.pulse)}
  previous=frame.beatIndex
 }
 expect(ages.length).toBeGreaterThan(10)
 expect(Math.max(...ages)).toBeLessThanOrEqual(hop+1e-5)
 expect(Math.max(...pulses)).toBeGreaterThan(.1)
})

test('recreating a layer, changing its rate, or suspending audio retains its spatial path',()=>{
 const motion=new SceneMotion(),settings={...defaults,effect:'rhythm_balls' as const}
 let u=commonUniforms(),drive=flowDriver(u)
 for(let i=0;i<180;i++){motion.step(packet(i),1/60,settings.music,false);drive(motion,settings,false,.8)}
 const before=u.uPhase.value
 expect(before).toBeGreaterThan(.3)
 u=commonUniforms();drive=flowDriver(u)
 drive(motion,settings,false,.8)
 expect(u.uPhase.value).toBe(before)
 drive(motion,settings,false,3)
 expect(u.uPhase.value).toBe(before)
 motion.step(packet(180),1/60,settings.music,false);drive(motion,settings,false,3)
 expect(u.uPhase.value).toBeGreaterThan(before)
 expect(u.uPhase.value-before).toBeLessThan(.03)
 const classic=u.uPhase.value,ambient=motion.phase
 motion.reset(true)
 motion.step({...packet(181),streamId:2},1/60,settings.music,false);drive(motion,settings,false,3)
 expect(u.uPhase.value).toBeGreaterThanOrEqual(classic)
 expect(motion.phase).toBeGreaterThanOrEqual(ambient)
 const frozen=u.uPhase.value
 motion.step(packet(182),1/30,settings.music,true);drive(motion,settings,true,3)
 expect(u.uPhase.value).toBe(frozen)
})

test('30, 60 and 120Hz retain the same events and nearly the same integrated paths',()=>{
 const run=(fps:number)=>{
  const timeline=new AudioFeatureTimeline(),motion=new SceneMotion(),u=commonUniforms(),drive=flowDriver(u)
  let sequence=0,audio=packet(0);const beats:number[]=[]
  for(let frame=0;frame<fps*6;frame++){
   const time=frame/fps*1000
   while(sequence*1024/48<=time){audio={...packet(sequence),rms:sequence%23<2?.25:.04};timeline.push(audio,sequence*1024/48);sequence++}
   motion.step(audio,1/fps,defaults.music,false,timeline.sample(time,defaults.music));drive(motion,defaults,false,.8)
   if(motion.frame?.onset)beats.push(motion.frame.beatIndex)
  }
  return {phase:u.uPhase.value,ambient:motion.phase,beats}
 }
 const slow=run(30),medium=run(60),fast=run(120)
 expect(slow.beats).toEqual(fast.beats);expect(medium.beats).toEqual(fast.beats)
 expect(Math.abs(slow.phase-fast.phase)).toBeLessThan(.025)
 expect(Math.abs(medium.phase-fast.phase)).toBeLessThan(.015)
 expect(Math.abs(slow.ambient-fast.ambient)).toBeLessThan(.025)
})
