import { expect, test } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { compositionTime } from '../src/features/spectrum/three/compositions/clock'
import { musicEffects } from '../src/features/spectrum/music-engine/catalog'
import { recommendedMusic } from '../src/features/spectrum/effect-presets'
import { silentAnalysis } from '../src/features/spectrum/music-analysis'

const input=(rms:number)=>({rms,bands:Array(6).fill(.4),spectrum:Array(48).fill(.4),skin:[]})

test('every effect preserves volume contrast in travel instead of playing at a minimum speed',()=>{
  for(const {value:effect} of musicEffects){
    const settings=recommendedMusic(effect)
    const measure=(rms:number)=>{
      const motion=new SceneMotion()
      for(let i=0;i<180;i++){
        motion.step(input(rms),1/60,settings,false)
        motion.flowPhase(effect,1,.3,false)
        compositionTime(motion,false)
      }
      const before=[motion.phase,motion.auroraPhase,motion.flowPhase(effect,1,.3,false),compositionTime(motion,false)]
      for(let i=0;i<60;i++){
        motion.step(input(rms),1/60,settings,false)
        motion.flowPhase(effect,1,.3,false)
        compositionTime(motion,false)
      }
      return [motion.phase,motion.auroraPhase,motion.flowPhase(effect,1,.3,false),compositionTime(motion,false)].map((value,i)=>value-before[i])
    }
    const quiet=measure(.015),loud=measure(.15)
    for(let i=0;i<quiet.length;i++){
      expect(quiet[i],effect).toBeGreaterThan(0)
      expect(loud[i]/quiet[i],effect).toBeGreaterThan(7)
    }
  }
})

test('zero samples and sub-threshold noise stop motion and visibility even during the gate hold',()=>{
  for(const {value:effect} of musicEffects){
    for(const rms of [0,.0001,.0007]){
      const motion=new SceneMotion(),settings=recommendedMusic(effect)
      for(let i=0;i<120;i++){
        motion.step(input(.15),1/60,settings,false)
        motion.flowPhase(effect,1,.3,false);compositionTime(motion,false)
      }
      const before=[motion.phase,motion.auroraPhase,motion.flowPhase(effect,1,.3,false),compositionTime(motion,false)]
      // Even stale loud band metadata cannot move a silent PCM source.
      motion.step(input(rms),1/60,settings,false)
      expect(motion.transporting,`${effect} / ${rms}`).toBe(false)
      expect(motion.presence,`${effect} / ${rms}`).toBe(0)
      expect([motion.phase,motion.auroraPhase,motion.flowPhase(effect,1,.3,false),compositionTime(motion,false)]).toEqual(before)
      for(let i=0;i<60;i++)motion.step(silentAnalysis(),1/60,settings,false)
      expect(motion.presence).toBe(0)
    }
  }
})

test('captured attacks accelerate travel at equal RMS and recover between attacks',()=>{
  const settings=recommendedMusic('butterfly_flock')
  const run=(attack:boolean)=>{
    const motion=new SceneMotion(),audio=input(.08)
    for(let i=0;i<180;i++){motion.step(audio,1/60,settings,false);motion.flowPhase('butterfly_flock',1,0,false)}
    const frame=motion.frame!,samples:number[]=[]
    for(let i=0;i<45;i++){
      const previous=motion.flowPhase('butterfly_flock',1,0,false)
      motion.step(audio,1/60,settings,false,{...frame,beatIndex:frame.beatIndex+1,beatAge:i*1000/60,
        beatStrength:attack?.8:0,transients:attack&&i<5?[.9,0,0]:[0,0,0]})
      samples.push((motion.flowPhase('butterfly_flock',1,0,false)-previous)*60)
    }
    return samples
  }
  const steady=run(false),attack=run(true)
  expect(Math.max(...attack.slice(0,12))).toBeGreaterThan(Math.max(...steady)*1.3)
  expect(attack.at(-1)!).toBeLessThan(Math.max(...attack)*.8)
})
