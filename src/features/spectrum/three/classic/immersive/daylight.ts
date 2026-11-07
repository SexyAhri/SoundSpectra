import * as T from 'three'
import { commonUniforms } from '../flow/shared'

export const daylightUniforms=()=>({...commonUniforms(),
  uSkyHigh:{value:new T.Color('#b8dce9')},uSkyLow:{value:new T.Color('#f4e7d1')},
})

/** World-space daylight remains behind the actual geometry when the view rotates. */
export function daylightSky(group:T.Group,uniforms:ReturnType<typeof daylightUniforms>){
 const sky=new T.Mesh(new T.SphereGeometry(310,32,20),new T.ShaderMaterial({
   uniforms,side:T.BackSide,depthWrite:false,toneMapped:false,
   vertexShader:'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform vec3 uSkyHigh,uSkyLow;varying vec3 vD;
   void main(){vec3 d=normalize(vD);float sky=smoothstep(-.15,.7,d.y);
     vec3 color=mix(uSkyLow,uSkyHigh,sky);
     float sun=pow(max(0.,dot(d,normalize(vec3(-.5,.35,-1.)))),32.);
     color+=vec3(1.,.84,.62)*sun*.09;
     gl_FragColor=vec4(color,1.);}`,
 }));sky.name='scene-backdrop';sky.renderOrder=-10;group.add(sky)
}
