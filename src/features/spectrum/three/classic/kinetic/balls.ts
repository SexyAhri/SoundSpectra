import * as T from 'three'
import { AudioClock, Batch, TAU, Tint, platform, touchEnergy, type KineticEffect } from './common'

/** Open-shell energy gyroscopes: a hero core and its smaller levitating satellites. */
export function bouncingSpheres(detail: number): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint()
  const shellGeometry=new T.SphereGeometry(1,detail<.8?24:40,12,0,TAU,0,Math.PI*.34)
  const shells=new Batch(group,shellGeometry,14)
  const cores=new Batch(group,new T.IcosahedronGeometry(1,2),7)
  const coreMaterial=cores.mesh.material as T.ShaderMaterial
  coreMaterial.transparent=true;coreMaterial.depthWrite=false
  const equators=new Batch(group,new T.TorusGeometry(1,.021,6,96),21,true)
  const arcs=new Batch(group,new T.TorusGeometry(1,.034,6,64,TAU*.34),28,true)
  const cages=new Batch(group,new T.TorusGeometry(1,.018,5,64),21,true)
  const hearts=new Batch(group,new T.IcosahedronGeometry(1,1),7,true)
  const satellites=new Batch(group,new T.IcosahedronGeometry(1,1),70,true)
  const stage=platform(group,12,-5.5)
  return {group,update(motion,config,reduced){
    tint.update(config);stage.update(tint)
    const time=clock.step(motion,reduced,(.14+config.music.ballSpeedMultiplier*.25)*(.55+config.music.speed*.2))
    const count=config.music.ballCount,touch=touchEnergy(motion),base=.75+config.music.ballRadiusMultiplier*.8
    let traces=0
    for(let i=0;i<count;i++) {
      const hero=i===0,angle=(i-1)/Math.max(1,count-1)*TAU+time*.16
      const orbit=hero?0:7.2+(i%2)*1.1
      const x=Math.cos(angle)*orbit,z=Math.sin(angle)*orbit*.72
      const y=hero?.6+Math.sin(time*.7)*.35:Math.sin(angle*1.7+time*.5)*1.15-.7
      const radius=base*(hero?1.35:.61)*(1+motion.bass*.12+touch*.06)
      const spin=time*(hero?.28:-.35)+i*.8,tilt=hero?.28:.45
      shells.place(i*2,x,y,z,radius,radius,radius,tint.body,1,tilt,spin)
      shells.place(i*2+1,x,y,z,radius,radius,radius,tint.body,1,Math.PI+tilt,spin)
      cores.place(i,x,y,z,radius*.37,radius*.37,radius*.37,tint.at(i/count,.8+motion.middle*.5),.48,spin*.3,spin)
      hearts.place(i,x,y,z,radius*.17,radius*.17,radius*.17,tint.high,.7+motion.bass*.25,spin*.3,spin)
      for(let j=0;j<3;j++) {
        const r=radius*(j===0?.89:j===1?1.12:1.28)
        const rx=j===0?Math.PI/2+tilt:j===1?.55:1.1,ry=j===0?spin:spin*(j===1?1:-.7)
        equators.place(i*3+j,x,y,z,r,r,r,tint.at(j/2),j===0?.65:.26,rx,ry,j*.45)
        const inner=radius*.58
        cages.place(i*3+j,x,y,z,inner,inner,inner,tint.at(j/2),.35+motion.middle*.22,j*Math.PI/3,spin*.7,j*.6)
      }
      for(let j=0;j<4;j++) {
        const r=radius*(j<2?1.12:1.28),rx=j<2?.55:1.1,ry=spin*(j<2?1:-.7)
        arcs.place(i*4+j,x,y,z,r,r,r,tint.at(j<2?0:1),.5+motion.treble*.2,rx,ry,(j%2)*Math.PI+time*.16)
      }
      const length=Math.round(config.music.ballTrail*10)
      for(let j=0;j<length;j++) {
        const a=spin-j*.13,r=radius*1.3,s=.055*(1-j/Math.max(1,length))
        satellites.place(traces++,x+Math.cos(a)*r,y+Math.sin(a)*r*.6,z+Math.sin(a)*r*.8,s,s,s,tint.high,reduced?0:.5*(1-j/length))
      }
    }
    shells.finish(count*2);cores.finish(count);hearts.finish(count);cages.finish(count*3);equators.finish(count*3);arcs.finish(count*4);satellites.finish(traces)
  }}
}
