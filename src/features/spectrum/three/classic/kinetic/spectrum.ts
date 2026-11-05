import * as T from 'three'
import { AudioClock, Batch, TAU, Tint, spectral, touchEnergy, platform, type KineticEffect } from './common'

/** Dark frequency spires, thin luminous cap edges and captured-history depth terraces. */
export function spectrumArchitecture(): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint()
  const bars=new Batch(group,new T.BoxGeometry(1,1,1),160)
  const edges=new Batch(group,new T.BoxGeometry(1,1,1),960,true)
  const panels=new Batch(group,new T.BoxGeometry(1,1,1),480,true)
  const notes=new Batch(group,new T.OctahedronGeometry(.09),120,true)
  const values=new Float32Array(40),history=new Float32Array(160)
  const stage=platform(group,14,-5.05)
  let accumulator=0,lastCount=0
  return {group,update(motion,config,reduced){
    tint.update(config);stage.update(tint);clock.step(motion,reduced)
    const count=config.music.spectrumTracks
    if(count!==lastCount||clock.reset){history.fill(0);values.fill(0);accumulator=0;lastCount=count}
    const dt=clock.dt,decay=2+config.music.speed*2.5
    for(let i=0;i<count;i++) {
      const target=spectral(motion,i/Math.max(1,count-1))**.75
      values[i]+=(target-values[i])*(1-Math.exp(-dt*(target>values[i]?18:decay)))
    }
    if(!reduced&&motion.frame?.audible)accumulator+=dt
    if(accumulator>.12){history.copyWithin(40,0,120);history.set(values,0);accumulator%=.12}
    if(reduced)for(let r=0;r<4;r++)history.set(values,r*40)
    const touch=touchEnergy(motion),width=25/count*.62,depth=1.35
    let line=0,panel=0
    for(let row=0;row<4;row++)for(let i=0;i<count;i++) {
      const value=row===0?values[i]:history[(row-1)*40+i],location=i/Math.max(1,count-1)
      const silhouette=(.5+.5*Math.sin(location*Math.PI))*(.8+row*.22)*(i%3===0?1.3:.86)
      const h=.4+(value*15+touch*Math.exp(-Math.pow((location-.5)*5,2)))*config.music.spectrumAmplitude*silhouette
      const x=(location-.5)*25,y=-4.8+h*.5,z=4.4-row*2.8,index=row*count+i,top=y+h*.5
      bars.place(index,x,y,z,width,h,depth,tint.at(location,.2))
      const color=tint.at(location*.7+row*.08,1.25),alpha=.55+value*.4
      for(const side of [-1,1]) {
        edges.place(line++,x,top,z+side*depth*.5,width+.03,.025,.025,color,alpha)
        edges.place(line++,x+side*width*.5,top,z,.025,.025,depth,color,alpha)
        edges.place(line++,x+side*width*.5,y,z+depth*.5,.018,h,.018,color,alpha*.3)
      }
      for(let j=0;j<3;j++) {
        const level=(j+.8)/3.4
        panels.place(panel++,x,-4.8+h*level,z+depth*.5+.015,width*.66,.04,.02,tint.at(location*.6+row*.12,1.5),(.15+value*.75)*(1-j*.16))
      }
    }
    let n=0
    for(let i=0;i<count;i++)for(let j=0;j<config.music.spectrumNoteDensity;j++) {
      const location=i/Math.max(1,count-1),energy=values[i],height=.4+energy*15*config.music.spectrumAmplitude*(.5+.5*Math.sin(location*Math.PI))*.8*(i%3===0?1.3:.86)
      const age=(clock.time*.25+i*.37+j*.31)%1
      notes.place(n++,(location-.5)*25,-4.8+height+.4+age*(1+energy*2),4.4-j*.2,1,1,1,tint.high,reduced?0:Math.sin(age*Math.PI)*energy*.35)
    }
    bars.finish(count*4);edges.finish(line);panels.finish(panel);notes.finish(n)
  }}
}

function bladeGeometry() {
  const shape=new T.Shape();shape.moveTo(-.4,-.5);shape.lineTo(.05,-.5);shape.lineTo(.4,.38);shape.lineTo(.1,.5);shape.closePath()
  const geometry=new T.ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,steps:1});geometry.translate(0,0,-.25);return geometry
}

/** A hollow reactor crown, with swept graphite vanes and luminous blade tips. */
export function spectrumCrown(): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint(),values=new Float32Array(40)
  const blades=new Batch(group,bladeGeometry(),80)
  const tips=new Batch(group,new T.BoxGeometry(1,.035,1),120,true)
  const rails=new Batch(group,new T.TorusGeometry(1,.012,5,128),5,true)
  const seams=new Batch(group,new T.CylinderGeometry(.014,.014,1,4),80,true)
  const core=new Batch(group,new T.IcosahedronGeometry(1,1),1)
  const coreMaterial=core.mesh.material as T.ShaderMaterial
  coreMaterial.transparent=true;coreMaterial.depthWrite=false
  const nucleus=new Batch(group,new T.IcosahedronGeometry(1,1),1,true)
  const stage=platform(group,11,-4.05)
  return {group,update(motion,config,reduced){
    tint.update(config);stage.update(tint);const time=clock.step(motion,reduced,.25)
    if(clock.reset)values.fill(0)
    const count=config.music.spectrumTracks,touch=touchEnergy(motion),radius=8.4+motion.bass*.5+touch*.3
    let n=0
    for(let i=0;i<count;i++) {
      const location=i/Math.max(1,count-1),target=spectral(motion,location)**.75
      values[i]+=(target-values[i])*(1-Math.exp(-clock.dt*(target>values[i]?20:2+config.music.speed*2.5)))
      const angle=i/count*TAU,h=.6+(values[i]*11+touch*.6)*config.music.spectrumAmplitude*(i%4===0?1.25:1)
      for(let row=0;row<2;row++) {
        const r=row===0?radius:radius*.57,height=h*(row===0?1:.7),width=TAU*r/count*.75
        const x=Math.cos(angle)*r,z=Math.sin(angle)*r,index=row*count+i,turn=-angle+Math.PI/2
        blades.place(index,x,-3.6+height*.5,z,width,height,1,tint.at(row===0?location:.85,.24),1,0,turn)
        seams.place(index,x,-3.6+height*.5,z+.02,1.2,height*.8,1.2,tint.at(location),.35+values[i]*.3)
      }
      for(let j=0;j<config.music.spectrumNoteDensity;j++) {
        const a=angle+.025,r=radius,dy=.035+j*.09
        tips.place(n++,Math.cos(a)*r,-3.6+h+dy,Math.sin(a)*r,TAU*r/count*.36,1,.6,tint.at(location),.55+values[i]*.35,0,-angle+Math.PI/2)
      }
    }
    rails.place(0,0,-3.7,0,radius,radius,radius,tint.cool,.3,Math.PI/2)
    rails.place(1,0,-3.7,0,radius*.57,radius*.57,radius*.57,tint.warm,.26,Math.PI/2)
    for(let j=0;j<3;j++) {
      const r=1.7+Math.sin(time+j)*.08+motion.bass*.2
      rails.place(j+2,0,-1.2,0,r,r,r,tint.at(j/2),.5+motion.volume*.3,Math.PI/2+j*.8,time*.6+j)
    }
    const size=.75+motion.bass*.3
    core.place(0,0,-1.2,0,size,size,size,tint.at(.35,.65),.5,time*.2,time*.3)
    nucleus.place(0,0,-1.2,0,size*.45,size*.45,size*.45,tint.high,.8)
    rails.finish();core.finish();nucleus.finish();blades.finish(count*2);seams.finish(count*2);tips.finish(n)
  }}
}
