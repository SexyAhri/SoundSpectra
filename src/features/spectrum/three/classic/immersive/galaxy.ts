import * as T from 'three'
import { randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { luminousDriver, luminousSource, luminousUniforms } from './luminous-motion'
import { volumeGlow } from './volume-glow'

// One angular field for the gas and its stars. Orbiting the camera cannot
// expose a carrier-plane edge or rotate the river away from its star band.
const galaxySpace=`
float galaxyTurn(){return uPhase*.018*(.3+uTrail);}
vec2 galaxyCoordinates(vec3 direction){
  vec3 d=normalize(direction);
  vec2 p=vec2(atan(d.x,-d.z),asin(clamp(d.y,-1.,1.)))*3./uDepth;
  p.y-=p.x*.28;
  float turn=galaxyTurn();return mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p;
}
vec3 galaxyDirection(vec2 p){
  float turn=-galaxyTurn();p=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p;
  p.y+=p.x*.28;p*=uDepth/3.;
  return vec3(sin(p.x)*cos(p.y),sin(p.y),-cos(p.x)*cos(p.y));
}
`

/** A sky-spanning star river: moving emission, independent dust and depth-layered stars. */
export function createGalaxy(detail: number): FlowEffect {
  const group = new T.Group(), uniforms = { ...luminousUniforms(), uSpan: { value: 100 },uDust:{value:.65},uDesktop:{value:0},uGalaxyWaves:{value:Array.from({length:8},()=>new T.Vector4(10,0,0,0))} }, drive = luminousDriver(uniforms)
  const waves:{age:number;life:number;strength:number;origin:number}[]=[]
  let beat=-1
  const sky = new T.Mesh(new T.SphereGeometry(240,64,40), new T.ShaderMaterial({ uniforms, side:T.BackSide, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `${uniformSource}${luminousSource}${volumeGlow}${galaxySpace}
      uniform float uDust,uDesktop;uniform vec4 uGalaxyWaves[8];varying vec3 vDirection;
      void main(){
        vec2 p=galaxyCoordinates(vDirection);
        float flow=uPhase*.14*(.5+uTrail);
        vec2 curl=vec2(fbm(p*1.4+vec2(flow,-flow*.5)),fbm(p*1.4+vec2(4.2-flow*.3,flow)))-.5;
        vec2 gas=p+curl*(.46+uSlowBass*.16);
        float width=.54+uSlowBass*.09;
        float ends=exp(-pow(abs(p.x)/4.2,6.));
        float band=exp(-pow(gas.y/width,2.))*ends;
        float core=exp(-pow((p.x+.25)/1.9,2.));
        float clouds=fbm(gas*3.1+vec2(flow*.3,0.));
        float fine=fbm(gas*17.);
        float knots=pow(fbm(gas*6.7),2.);
        float dust=fbm(p*4.8+curl*2.+vec2(-flow*.2,11.));
        float split=exp(-pow((gas.y+.045+sin(p.x*2.)*.07)/(.075+dust*.19),2.));
        float absorb=clamp((split*(.65+dust*.5)+smoothstep(.52,.73,dust)*band*.7)*uDust/.65,0.,.98);
        float density=band*(.16+clouds*.75+knots*.45+fine*.18)*(1.-absorb)*(.5+core*.7);
        float outskirts=exp(-pow(gas.y/1.1,2.))*clouds*.055*ends;
        vec3 cool=mix(uColor,uAccent,smoothstep(-2.,2.,p.x)*.6);
        vec3 warm=mix(uAccent,uHighlight,.45);
        vec3 emission=mix(cool,warm,core*.7)*density*(.48+uSlowMid*.55);
        emission+=uColor*outskirts;
        float pulse=0.;
        for(int i=0;i<8;i++){
          vec4 wave=uGalaxyWaves[i];
          float front=abs(gas.x-wave.z)-wave.x*2.4;
          float attack=1.-exp(-wave.w*35.);
          pulse+=exp(-front*front/ .06)*attack*attack*exp(-wave.w*3.5)*wave.y;
        }
        // Local bright knots answer captured attacks; the cloud field follows
        // phrase energy rather than playing an unrelated shimmer animation.
        emission+=mix(uAccent,uHighlight,.6)*density*pulse*2.;
        vec3 darkness=uShade*.18*(1.-uDesktop);
        float alpha=clamp(band*(.45+clouds*.4)+absorb*band*.14,0.,.9);
        if(alpha<.002)discard;
        gl_FragColor=vec4(darkness+emission,alpha);
      }` }))
  sky.name='galaxy-gas';sky.frustumCulled=false;sky.renderOrder = -2; group.add(sky)
  const random = randomStream(542981), count = Math.round(6000 * Math.max(.5, Math.min(1.25, detail)))
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const x = random() - .5, dense = random() < .76
    const gaussian = Math.sqrt(-2 * Math.log(Math.max(.0001, random()))) * Math.cos(random() * Math.PI * 2)
    const y = dense ? gaussian * (.05 + Math.abs(x) * .025) : (random() - .5) * 1.3
    positions.set([x, y, random()], i * 3)
    seeds.set([random(), random(), random(), dense ? 1 : 0], i * 4)
  }
  const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)).setAttribute('aSeed', new T.BufferAttribute(seeds, 4))
  const stars = new T.Points(geometry, new T.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    vertexShader: `${uniformSource}${luminousSource}${galaxySpace}attribute vec4 aSeed;varying float vAlpha,vTint,vBright;varying vec2 vBand;
      void main(){
        vec2 field=vec2(position.x*7.5,position.y*4.6);
        field+=vec2(sin(uPhase*.18+aSeed.x*6.),cos(uPhase*.13+aSeed.y*6.))*.012*(.4+position.z);
        vec3 p=galaxyDirection(field)*(170.+position.z*55.);
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        float bright=step(.97,aSeed.y);vBright=bright;
        gl_PointSize=clamp((.65+pow(aSeed.y,14.)*2.5+bright*3.)*200./max(30.,-mv.z),.65,6.)*uPixelRatio;
        float note=uSpectrum[int(min(47.,floor(aSeed.x*48.)))];
        gl_PointSize*=1.+bright*uAccents.z*.35;
        vAlpha=(.13+aSeed.y*.5)*(1.+bright*(uAccents.z*(.5+note)*2.4+uBeatGlow*.45));
        vTint=aSeed.x;vBand=field;
      }`,
    fragmentShader: `${uniformSource}${volumeGlow}varying float vAlpha,vTint,vBright;varying vec2 vBand;
      void main(){vec2 q=gl_PointCoord-.5;float r=length(q)*2.;if(r>1.)discard;
        float dust=fbm(vBand*4.8+11.);float slit=exp(-pow((vBand.y+.04)/(.075+dust*.19),2.));
        float a=(exp(-r*r*14.)+exp(-r*r*3.)*.12)*vAlpha*(1.-slit*dust*.8);
        vec3 tint=mix(uColor,uAccent,step(.78,vTint));tint=mix(tint,uHighlight,.55+vBright*.35);
        float spike=vBright*(exp(-abs(q.x)*80.)*exp(-abs(q.y)*12.)+exp(-abs(q.y)*80.)*exp(-abs(q.x)*12.))*.15;
        gl_FragColor=vec4(tint*(1.+vBright*1.2),a+spike*vAlpha);
      }` }))
  stars.frustumCulled = false; group.add(stars)
  return { group, update(motion, config, reduced) {
    const dt=drive(motion, config, reduced, .65 + config.music.speed * .18)
    for(const wave of waves){wave.life+=dt;if(!reduced)wave.age+=dt}
    while(waves.length&&waves[0].life>1.5)waves.shift()
    const frame=motion.frame
    if(!reduced&&motion.transporting&&frame?.onset&&frame.beatIndex!==beat){
      beat=frame.beatIndex;if(waves.length===8)waves.shift()
      waves.push({age:0,life:0,strength:motion.onsetStrength*(frame.bandOnsets[0]?1:.65),origin:(uniforms.uOnsetOrigin.value-.5)*5.5})
    }
    uniforms.uGalaxyWaves.value.forEach((value,i)=>{const wave=waves[i];value.set(wave?.age??10,wave?.strength??0,wave?.origin??0,wave?.life??10)})
    uniforms.uDepth.value = config.music.nebulaScale; uniforms.uTrail.value = config.music.spinSpeed
    uniforms.uDust.value=config.music.dustOpacity
    uniforms.uDesktop.value=Number(config.sceneMode==='daily')
    geometry.setDrawRange(0, Math.round(count * config.music.starDensity / 6000))
  } }
}
