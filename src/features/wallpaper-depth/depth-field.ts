export type DepthProfile='landscape'|'left-foreground'
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
// The optional foreground outline is a composition guide, not inferred scene geometry.
const cottage=[ [0,0],[.26,0],[.29,.04],[.29,.10],[.38,.06],[.43,.22],[.45,.27],[.43,.42],[.49,.42],[.50,.53],[.44,.54],[.46,.69],[.43,.81],[.54,1],[0,1] ]
function outlineDistance(x:number,y:number){
 let inside=false,distance=1
 for(let i=0,j=cottage.length-1;i<cottage.length;j=i++){
   const [ax,ay]=cottage[i],[bx,by]=cottage[j]
   if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside
   const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
   distance=Math.min(distance,Math.hypot(x-ax-t*dx,y-ay-t*dy))
 }
 return (inside?1:-1)*distance
}
export function depthAt(x:number,y:number,profile:DepthProfile){
 const ground=smooth(.30,1.,y),foreground=smooth(.72,1.,y)
 let depth=.08+ground*.34+foreground*.45
 if(profile==='left-foreground'){
   const mask=smooth(-.007,.007,outlineDistance(x,y))
   depth=depth*(1-mask)+(.55+smooth(.25,1.,y)*.30)*mask
 }
 return Math.min(1,depth)
}
export function depthPixels(profile:DepthProfile,width=384,height=216){
 const pixels=new Uint8Array(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const offset=(y*width+x)*4,value=Math.round(depthAt(x/(width-1),1-y/(height-1),profile)*255)
   pixels.set([value,value,value,255],offset)
 }
 return {pixels,width,height}
}
