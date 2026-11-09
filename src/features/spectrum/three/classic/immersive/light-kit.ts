import { volumeGlow as basicGlow } from "./volume-glow";

/** Emission helpers; the curl is derived from a smooth vector potential. */
export const volumeGlow = `${basicGlow}
vec3 curlNoise3D(vec3 p){
  vec3 a=vec3(p.y+.7*p.z,p.z+.8*p.x,p.x+.9*p.y);
  return vec3(.9*cos(a.z)-cos(a.y),.7*cos(a.x)-cos(a.z),.8*cos(a.y)-cos(a.x));
}
float depthFade(float depth){return clamp(110./max(30.,depth),.25,1.);}
float fresnelShell(vec3 n,vec3 view,float power){
  n/=max(length(n),.00001);view/=max(length(view),.00001);
  return pow(clamp(1.-abs(dot(n,view)),0.,1.),power);
}
`;
