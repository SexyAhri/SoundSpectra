import { expect, test } from '@playwright/test'
import { AudioFeatureTimeline } from '../src/features/spectrum/audio-feature-timeline'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { SceneMotion } from '../src/features/spectrum/three/motion'

const packet=(sequence:number,rms=.15,sourceRevision=1,streamId=1)=>({
  sourceRevision,streamId,sequence,samplePosition:4096+sequence*1024,sampleRate:48000,
  rms,bands:Array(6).fill(.45),spectrum:Array(48).fill(.5),skin:[],
})

test('capture frames drive one onset history at 30, 60 and 120Hz with several regions',()=>{
  const run=(fps:number,regions:number)=>{
    const timeline=new AudioFeatureTimeline(),motions=Array.from({length:regions},()=>new SceneMotion())
    let next=0,last=packet(0),onsets=0
    const indices:number[]=[]
    for(let render=0;render<fps*4;render++){
      const now=render/fps*1000
      while(next*1024/48000*1000<=now){
        const rms=next%23<3?.32:.035
        last=packet(next,rms);timeline.push(last,next*1024/48000*1000);next++
      }
      const shared=timeline.sample(now,defaultMusicSettings)!
      for(const motion of motions)motion.step(last,1/fps,defaultMusicSettings,false,shared)
      if(motions[0].frame!.onset){onsets++;indices.push(shared.beatIndex)}
      expect(motions.every(motion=>motion.frame!.beatIndex===shared.beatIndex)).toBe(true)
    }
    return {onsets,indices,processed:timeline.processed}
  }
  const slow=run(30,1),fast=run(120,4)
  expect(slow.onsets).toBeGreaterThan(3)
  expect(slow.indices).toEqual(fast.indices)
  expect(run(60,2).indices).toEqual(slow.indices)
  expect(slow.processed).toBeLessThanOrEqual(fast.processed)
})

test('duplicate packets, old sources and regressing clocks cannot retrigger; reconnects reset',()=>{
  const timeline=new AudioFeatureTimeline()
  expect(timeline.push(packet(1),10)).toBe(true)
  const generation=timeline.generation
  expect(timeline.push(packet(1),20)).toBe(false)
  expect(timeline.push({...packet(2),samplePosition:0},30)).toBe(false)
  expect(timeline.push(packet(1,.1,2,2),40)).toBe(true)
  expect(timeline.generation).toBeGreaterThan(generation)
  expect(timeline.push(packet(100,.3,1,1),50)).toBe(false)
  expect(timeline.push(packet(2,.1,2,1),50)).toBe(false)
  expect(timeline.sample(400,defaultMusicSettings)).toBeNull()
  expect(timeline.push(packet(2,.2,2,2),500)).toBe(true)
  expect(timeline.sample(500,defaultMusicSettings)!.intensitySample.current).toBe(.2)
})

test('arrival jitter changes interpolation, but onset detection uses the sample clock and preserves RMS',()=>{
  const a=new AudioFeatureTimeline(),b=new AudioFeatureTimeline()
  for(let i=0;i<80;i++){
    const audio=packet(i,i%20<2?.3:.02)
    a.push(audio,i*1024/48000*1000)
    b.push(audio,i*1024/48000*1000+(i%3)*7)
  }
  const now=80*1024/48000*1000
  const first=a.sample(now,defaultMusicSettings)!,second=b.sample(now,defaultMusicSettings)!
  expect(first.beatIndex).toBe(second.beatIndex)
  expect(first.beatStrength).toBe(second.beatStrength)
  expect(first.intensitySample.current).toBe(.02)
  const quiet=new AudioFeatureTimeline(),loud=new AudioFeatureTimeline()
  for(let i=0;i<50;i++){quiet.push(packet(i,.02),i*22);loud.push(packet(i,.2),i*22)}
  expect(loud.sample(1100,defaultMusicSettings)!.displayIntensity!).toBeGreaterThan(quiet.sample(1100,defaultMusicSettings)!.displayIntensity!*5)
})

test('delayed delivery of continuous samples keeps onset history and gain cannot change source events',()=>{
  const timeline=new AudioFeatureTimeline()
  for(let i=0;i<30;i++)timeline.push(packet(i,i%15<2?.3:.02),i*22)
  const generation=timeline.generation
  timeline.push(packet(30,.3),1600)
  expect(timeline.generation).toBe(generation)
  const soft=timeline.sample(1610,{sensitivity:.5,response:'soft'})!
  const strong=timeline.sample(1610,{sensitivity:2,response:'responsive'})!
  expect(soft.beatIndex).toBe(strong.beatIndex)
  expect(soft.beatAge).toBe(strong.beatAge)
  expect(soft.beatStrength).toBe(strong.beatStrength)
  expect(strong.displayIntensity!).toBeGreaterThan(soft.displayIntensity!)
})
