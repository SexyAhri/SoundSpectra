import { useEffect,useRef,useState,type RefObject } from 'react'
import * as T from 'three'
import { invoke } from '@tauri-apps/api/core'
import type { WallpaperDepthSettings } from '../spectrum/model'
import { depthPixels } from './depth-field'
import { useDepthImage } from './image-store'
import './wallpaper-depth.css'

const fragment=`uniform sampler2D uImage,uDepth;uniform vec2 uCover,uPointer,uOffset;uniform float uAmount;varying vec2 vUv;
void main(){
 vec2 base=(vUv-.5)*uCover*(1.-uAmount*2.)+.5+uOffset,uv=base;
 for(int i=0;i<3;i++){float depth=texture2D(uDepth,uv).r;uv=base-uPointer*vec2(1.,-.65)*uCover*uAmount*(depth-.08);}
 gl_FragColor=vec4(texture2D(uImage,clamp(uv,.001,.999)).rgb,1.);
 #include <colorspace_fragment>
}`

export function DepthWallpaper({settings,active=true,desktop=false,host}:{settings:WallpaperDepthSettings;active?:boolean;desktop?:boolean;host?:RefObject<HTMLElement|null>}){
 const {image,error:loadError}=useDepthImage(settings.revision),canvas=useRef<HTMLCanvasElement>(null)
 const [ready,setReady]=useState(false),[error,setError]=useState<string|null>(null)
 const live=useRef({amount:settings.amount,focusX:settings.focusX,focusY:settings.focusY,active});live.current={amount:settings.amount,focusX:settings.focusX,focusY:settings.focusY,active}
 useEffect(()=>{
   setReady(false);setError(null)
   if(!image||!canvas.current)return
   const surface=canvas.current
   let renderer:T.WebGLRenderer|undefined,texture:T.Texture|undefined,disposed=false,frame=0,poll=0
   const pointer=new T.Vector2(),target=new T.Vector2(),reduced=matchMedia('(prefers-reduced-motion: reduce)')
   const map=depthPixels(settings.profile),depth=new T.DataTexture(map.pixels,map.width,map.height,T.RGBAFormat)
   depth.minFilter=depth.magFilter=T.LinearFilter;depth.needsUpdate=true
   const uniforms={uImage:{value:null as T.Texture|null},uDepth:{value:depth},uPointer:{value:pointer},uCover:{value:new T.Vector2(1,1)},uOffset:{value:new T.Vector2()},uAmount:{value:0}}
   const geometry=new T.PlaneGeometry(2,2),material=new T.ShaderMaterial({uniforms,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment,depthTest:false,depthWrite:false,toneMapped:false})
   const scene=new T.Scene(),camera=new T.Camera();scene.add(new T.Mesh(geometry,material))
   const fail=(reason:unknown)=>{if(!disposed){setError(`立体壁纸暂不可用：${reason instanceof Error?reason.message:String(reason)}`);setReady(false)}}
   const draw=()=>{
     frame=0;if(disposed||!renderer||!texture)return
     const moving=live.current.active&&!document.hidden&&!reduced.matches
     pointer.lerp(moving?target:new T.Vector2(),.13)
     uniforms.uAmount.value=reduced.matches?0:Math.min(100,Math.max(0,live.current.amount))*.0003
     uniforms.uOffset.value.set((1-uniforms.uCover.value.x)*(live.current.focusX/100-.5),(1-uniforms.uCover.value.y)*(.5-live.current.focusY/100))
     renderer.render(scene,camera)
     surface.dataset.camera=`${pointer.x.toFixed(4)},${pointer.y.toFixed(4)}`
     if(moving&&pointer.distanceToSquared(target)>.000001)frame=requestAnimationFrame(draw)
   }
   const request=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(draw)}
   const resize=()=>{
     if(!renderer)return
     const width=Math.max(1,surface.clientWidth),height=Math.max(1,surface.clientHeight),ratio=image.width/image.height,view=width/height
     const scale=Math.min(devicePixelRatio,1.25,Math.sqrt(8_000_000/(width*height)))
     renderer.setSize(Math.round(width*scale),Math.round(height*scale),false)
     uniforms.uCover.value.set(ratio>view?view/ratio:1,ratio>view?1:ratio/view);request()
   }
   try{renderer=new T.WebGLRenderer({canvas:surface,alpha:false,antialias:false,powerPreference:'low-power'});renderer.outputColorSpace=T.SRGBColorSpace
     const source=new Image();source.onload=()=>{if(disposed)return;texture=new T.Texture(source);texture.colorSpace=T.SRGBColorSpace;texture.minFilter=T.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;uniforms.uImage.value=texture;resize();setReady(true)};source.onerror=()=>fail(new Error('图片加载失败'));source.src=image.dataUrl
   }catch(reason){fail(reason)}
   const observer=new ResizeObserver(resize);observer.observe(surface)
   const element=host?.current??surface.parentElement
   const move=(event:PointerEvent)=>{if(desktop||!element||!live.current.active)return;const box=element.getBoundingClientRect();target.set(Math.max(-1,Math.min(1,(event.clientX-box.left)/box.width*2-1)),Math.max(-1,Math.min(1,(event.clientY-box.top)/box.height*2-1)));request()}
   const leave=()=>{target.set(0,0);request()}
   const sample=async()=>{
     if(disposed)return
     if(live.current.active&&!reduced.matches&&!document.hidden)try{const p=await invoke<[number,number]>('desktop_pointer');if(!disposed&&target.distanceToSquared(new T.Vector2(...p))>.000001){target.set(...p);request()}}catch{/* Keep the still image if pointer access is temporarily unavailable. */}
     if(!disposed)poll=window.setTimeout(sample,80)
   }
   if(desktop)void sample();else{element?.addEventListener('pointermove',move);element?.addEventListener('pointerleave',leave)}
   reduced.addEventListener('change',request);document.addEventListener('visibilitychange',request)
   // Amount/active updates redraw through the small settings event below.
   surface.addEventListener('depth-settings',request)
   return()=>{disposed=true;cancelAnimationFrame(frame);clearTimeout(poll);observer.disconnect();element?.removeEventListener('pointermove',move);element?.removeEventListener('pointerleave',leave);reduced.removeEventListener('change',request);document.removeEventListener('visibilitychange',request);surface.removeEventListener('depth-settings',request);texture?.dispose();depth.dispose();geometry.dispose();material.dispose();renderer?.dispose();renderer?.forceContextLoss()}
 },[image,settings.profile,desktop,host])
 useEffect(()=>{canvas.current?.dispatchEvent(new Event('depth-settings'))},[settings.amount,settings.focusX,settings.focusY,active])
 if(!image)return loadError&&!desktop?<span className="depth-wallpaper-error" role="alert">{loadError}</span>:null
 return <div className="depth-wallpaper" data-testid="depth-wallpaper" data-profile={settings.profile} data-ready={ready}>
   {!ready&&<img src={image.dataUrl} style={{objectPosition:`${settings.focusX}% ${settings.focusY}%`}} alt="" />}
   <canvas ref={canvas} aria-label="分层视差壁纸" style={{visibility:ready?'visible':'hidden'}} />
   {error&&!desktop&&<span className="depth-wallpaper-error" role="alert">{error}</span>}
 </div>
}
