import * as T from 'three'
import { AudioClock, Batch, Tint, fract, random, platform, touchEnergy, type KineticEffect } from './common'

/** Falling droplets occupy a 3D volume; their floor rings follow the same individual cycles. */
export function fallingRain(detail: number): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint(),maximum=240
  const drops=new Batch(group,new T.SphereGeometry(1,10,8),maximum)
  const trails=new Batch(group,new T.CylinderGeometry(.35,1,1,5),maximum,true)
  const glints=new Batch(group,new T.SphereGeometry(1,8,6),maximum,true)
  const impacts=new Batch(group,new T.TorusGeometry(1,.018,4,48),maximum,true)
  const seeds=Array.from({length:maximum},(_,i)=>({x:(random(i*3)-.5)*26,z:(random(i*3+1)-.5)*16,p:random(i*3+2)}))
  const stage=platform(group,15,-5.7)
  return {group,update(motion,config,reduced){
    tint.update(config);stage.update(tint)
    const time=clock.step(motion,reduced,(.25+config.music.rainSpeedMultiplier*.24)*(.55+config.music.speed*.2))
    const count=Math.min(maximum,Math.round(config.music.rainCount*8*Math.min(detail,1.5)))
    const radius=.035+config.music.rainRadiusMultiplier*.035,wind=config.music.rainDirection==='down'?0:config.music.rainDirection==='left'?-.2:.2
    const touch=touchEnergy(motion)
    for(let i=0;i<count;i++) {
      const seed=seeds[i],cycle=fract(time*.65+seed.p),fall=cycle/.78
      const x=seed.x+wind*(1-Math.min(1,fall))*8,y=9.5-Math.min(1,fall)*15
      const visible=cycle<.78?1:0,length=.65+seed.p*.9+motion.middle*.6
      drops.place(i,x,y,seed.z,radius,radius*2.4,radius,tint.at(seed.p,.8+motion.treble*.5),visible,0,0,-wind)
      trails.place(i,x+wind*length*.5,y+length*.5,seed.z,radius*.65,length,radius*.65,tint.at(seed.p,1.3),reduced?0:visible*.48,0,0,-wind)
      glints.place(i,x,y-radius,seed.z,radius*.68,radius*.68,radius*.68,tint.high,visible*.8)
      const age=Math.max(0,(cycle-.78)/.22),r=.12+age*(1.1+motion.bass*.5+touch*.4)
      impacts.place(i,seed.x,-5.45,seed.z,r,r,r,tint.at(seed.p,1.4),cycle>=.78&&!reduced?Math.sin(age*Math.PI)*.65:0,Math.PI/2)
    }
    drops.finish(count);trails.finish(count);glints.finish(count);impacts.finish(count)
  }}
}

/** Bright fountain heads rise with volume, unlike the downward rain scene. */
export function volumeFountain(detail: number): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint(),maximum=144
  const heads=new Batch(group,new T.SphereGeometry(1,14,10),maximum)
  const tails=new Batch(group,new T.CylinderGeometry(1,.4,1,6),maximum,true)
  const bases=new Batch(group,new T.TorusGeometry(1,.025,4,40),maximum,true)
  const seeds=Array.from({length:maximum},(_,i)=>({x:(random(i*3+97)-.5)*25,z:(random(i*3+98)-.5)*14,p:random(i*3+99)}))
  const stage=platform(group,14,-5.5)
  return {group,update(motion,config,reduced){
    tint.update(config);stage.update(tint)
    const time=clock.step(motion,reduced,.35+config.music.speed*.16)
    const count=Math.min(maximum,Math.round(config.music.meteorDensity*Math.min(1.5,detail)))
    const lean=config.music.meteorAngle*Math.PI/180,touch=touchEnergy(motion)
    for(let i=0;i<count;i++) {
      const seed=seeds[i],cycle=fract(time*.4+seed.p),arc=Math.sin(cycle*Math.PI)
      const h=arc*(1.6+motion.volume*10+motion.bass*3+touch*3),x=seed.x+Math.sin(lean)*h,y=-4.9+Math.cos(lean)*h
      const size=(.08+motion.treble*.09)*(i%8===0?1.4:1),tail=Math.min(h,.35+config.music.meteorTrail*(1.2+motion.volume*2))
      heads.place(i,x,y,seed.z,size,size*1.2,size,tint.high)
      tails.place(i,x-Math.sin(lean)*tail*.5,y-Math.cos(lean)*tail*.5,seed.z,size*.6,Math.max(.01,tail),size*.6,tint.at(seed.p,1.3),reduced?0:.5,0,0,-lean)
      const r=.14+motion.volume*.2
      bases.place(i,seed.x,-5.15,seed.z,r,r,r,tint.at(seed.p),.22+arc*.3,Math.PI/2)
    }
    heads.finish(count);tails.finish(count);bases.finish(count)
  }}
}
