import * as T from 'three'
import { randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { luminousDriver, luminousSource, luminousUniforms } from './luminous-motion'
import { volumeGlow } from './volume-glow'

/** A sky-spanning star river: moving emission, independent dust and depth-layered stars. */
export function createGalaxy(detail: number): FlowEffect {
  const group = new T.Group(), uniforms = { ...luminousUniforms(), uSpan: { value: 100 },uDust:{value:.65} }, drive = luminousDriver(uniforms)
  const sky = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `${uniformSource}${luminousSource}${volumeGlow}
      uniform float uDust;varying vec2 vUv;
      void main(){
        vec2 p=(vUv-.5)*vec2(7.5,4.6)/uDepth;p.y-=p.x*.28;
        float turn=uPhase*.006*(.3+uTrail)/(1.+length(p)*.4);p=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p;
        float flow=uPhase*.022*(.5+uTrail);
        vec2 curl=vec2(fbm(p*1.4+vec2(flow,-flow*.5)),fbm(p*1.4+vec2(4.2-flow*.3,flow)))-.5;
        vec2 gas=p+curl*(.46+uSlowBass*.16);
        float width=.54+uSlowBass*.09;
        float band=exp(-pow(gas.y/width,2.));
        float core=exp(-pow((p.x+.25)/1.9,2.));
        float clouds=fbm(gas*3.1+vec2(flow*.3,0.));
        float fine=fbm(gas*17.);
        float knots=pow(fbm(gas*6.7),2.);
        float dust=fbm(p*4.8+curl*2.+vec2(-flow*.2,11.));
        float split=exp(-pow((gas.y+.045+sin(p.x*2.)*.07)/(.075+dust*.19),2.));
        float absorb=clamp((split*(.65+dust*.5)+smoothstep(.52,.73,dust)*band*.7)*uDust/.65,0.,.98);
        float density=band*(.16+clouds*.75+knots*.45+fine*.18)*(1.-absorb)*(.5+core*.7);
        float outskirts=exp(-pow(gas.y/1.1,2.))*clouds*.055;
        vec3 cool=mix(uColor,uAccent,smoothstep(-2.,2.,p.x)*.6);
        vec3 warm=mix(uAccent,uHighlight,.45);
        vec3 emission=mix(cool,warm,core*.7)*density*(.48+uSlowMid*.55);
        emission+=uColor*outskirts;
        float pulse=exp(-pow((gas.x-sin(uPhase*.13)*2.)/1.2,2.))*uBeatGlow*.16;
        emission+=uHighlight*density*pulse;
        vec3 darkness=uShade*.18;
        float alpha=clamp(.14+band*.65+absorb*.18,0.,.92);
        gl_FragColor=vec4(darkness+emission,alpha);
      }` }))
  sky.position.z = -80; sky.renderOrder = -2; group.add(sky)
  const random = randomStream(542981), count = Math.round(6000 * Math.max(.5, Math.min(1.25, detail)))
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const x = random() - .5, dense = random() < .76
    const gaussian = Math.sqrt(-2 * Math.log(Math.max(.0001, random()))) * Math.cos(random() * Math.PI * 2)
    const y = dense ? x * .46 + gaussian * (.05 + Math.abs(x) * .025) : (random() - .5) * 1.3
    positions.set([x, y, random()], i * 3)
    seeds.set([random(), random(), random(), dense ? 1 : 0], i * 4)
  }
  const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)).setAttribute('aSeed', new T.BufferAttribute(seeds, 4))
  const stars = new T.Points(geometry, new T.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    vertexShader: `${uniformSource}${luminousSource}uniform float uSpan;attribute vec4 aSeed;varying float vAlpha,vTint,vBright;varying vec2 vBand;
      void main(){
        vec3 p=vec3(position.x*uSpan,position.y*100.,-45.-position.z*35.*(.6+uDepth*.4));
        p.xy+=vec2(sin(uPhase*.025+aSeed.x*6.),cos(uPhase*.019+aSeed.y*6.))*(.06+uTrail*.14);
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        float bright=step(.97,aSeed.y);vBright=bright;
        gl_PointSize=clamp((.65+pow(aSeed.y,14.)*2.5+bright*3.)*100./max(30.,-mv.z),.65,6.)*uPixelRatio;
        float shimmer=.6+.4*sin(uPhase*(.4+aSeed.x)+aSeed.z*60.);
        vAlpha=(.13+aSeed.y*.5)*(1.+bright*(uFastHigh*shimmer*1.5+uBeatGlow*.6));
        vTint=aSeed.x;vBand=vec2(position.x*7.5,(position.y-position.x*.46)*4.6);
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
  return { group, layout(aspect) {
    const width = Math.max(100, aspect * 118)
    sky.scale.set(width, 145, 1); uniforms.uSpan.value = width * 1.05
  }, update(motion, config, reduced) {
    drive(motion, config, reduced, .65 + config.music.speed * .18)
    uniforms.uDepth.value = config.music.nebulaScale; uniforms.uTrail.value = config.music.spinSpeed
    uniforms.uDust.value=config.music.dustOpacity
    geometry.setDrawRange(0, Math.round(count * config.music.starDensity / 6000))
  } }
}
