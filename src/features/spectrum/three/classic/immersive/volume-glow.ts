// Shared light shaping. Occluding media still use normal blending; only emitted
// light is additive, so dust and crystal silhouettes survive pale wallpapers.
export const volumeGlow = `
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);}
float fbm(vec2 p){float f=0.,a=.5;mat2 m=mat2(.8,-.6,.6,.8);
 for(int i=0;i<6;i++){f+=noise2(p)*a;p=m*p*2.07+17.1;a*=.5;}return f;}
float fresnelLight(vec3 normal,vec3 view){return pow(clamp(1.-abs(dot(normalize(normal),normalize(view))),0.,1.),2.4);}
float softGlow(float radius){return exp(-radius*radius*5.);}
float dustTransmission(vec2 p){float lane=fbm(p*2.8+vec2(fbm(p*1.3),fbm(p*1.3+8.))*2.);
 return smoothstep(.3,.72,lane);}
`
