/** Matching CPU/GLSL paths keep the bell, wake and volume lights together. */
export function jellyfishCenter(phase: number, id: number, count: number, range: number, wide: number, depth: number) {
  const q=phase*(.32+(id*.137%1)*.075)+id*2.399963;
  const flatX=(id/Math.max(1,count-1)-.5)*range;
  const deepX=id===0?-2.5:Math.sin(id*2.399963)*range*.62;
  const deepY=id===0?2:5+Math.cos(id*1.73)*7;
  const deepZ=id===0?3:-5-(id%3)*8*depth-Math.floor(id/3)*5;
  return [deepX*(1-wide)+flatX*wide+Math.sin(q)*2.6+Math.sin(q*.43+id)*.45,
    deepY*(1-wide)+(2+Math.sin(id*2.4)*3)*wide+Math.sin(q*.71+id*.37)*1.8,
    deepZ*(1-wide)+(-1+Math.sin(id*5)*3)*wide+Math.cos(q)*1.35];
}

export const jellyfishPathSource = `
float swimPhase(float phase,float id){return phase*(.32+fract(id*.137)*.075)+id*2.399963;}
vec3 centerAt(float phase,float id){
  float q=swimPhase(phase,id);
  float flatX=(id/max(1.,uCount-1.)-.5)*uRange;
  float deepX=id<.5?-2.5:sin(id*2.399963)*uRange*.62;
  float deepY=id<.5?2.:5.+cos(id*1.73)*7.;
  float deepZ=id<.5?3.:-5.-mod(id,3.)*8.*uDepth-floor(id/3.)*5.;
  return vec3(mix(deepX,flatX,uTwist)+sin(q)*2.6+sin(q*.43+id)*.45,
    mix(deepY,2.+sin(id*2.4)*3.,uTwist)+sin(q*.71+id*.37)*1.8,
    mix(deepZ,-1.+sin(id*5.)*3.,uTwist)+cos(q)*1.35);
}
vec3 swimPoint(vec3 local,float id,float lag){
  float phase=uPhase+swimTravel(id)-lag,q=swimPhase(phase,id);
  float bank=cos(q)*.15,pitch=sin(q*.71+id*.37)*.14;
  local.xy=mat2(cos(bank),-sin(bank),sin(bank),cos(bank))*local.xy;
  local.yz=mat2(cos(pitch),-sin(pitch),sin(pitch),cos(pitch))*local.yz;
  return centerAt(phase,id)+local;
}
`;
