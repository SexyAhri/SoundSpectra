import { createRoot } from 'react-dom/client'
import { ThreeSceneCanvas } from '../../src/features/spectrum/three/scene-canvas'
import { defaults } from '../../src/features/spectrum/model'
import { FiberSceneRenderer } from '../../src/features/spectrum/three/r3f/fiber-renderer'

export function mountSceneResizeProbe() {
  const host = document.createElement('div')
  host.style.cssText = 'width:320px;height:180px'
  document.body.append(host)
  const original = FiberSceneRenderer.prototype.resize
  let world: FiberSceneRenderer | undefined, resizes = 0, bufferWrites = 0
  FiberSceneRenderer.prototype.resize = function (...args) {
    if (!world) for (const key of ['width','height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key)!
      Object.defineProperty(this.canvas,key,{...descriptor,set(value:number){bufferWrites++;descriptor.set!.call(this,value)}})
    }
    world = this; resizes++
    return original.apply(this, args)
  }
  const root = createRoot(host)
  root.render(<ThreeSceneCanvas settings={{ ...defaults, effect:'aurora_flow',quality:'eco', sceneMode:'immersive' }} demo={false} bands={{current:new Float32Array(96)}} receivedAt={{current:0}} />)
  return {
    resize(width:number,height:number) { host.style.width=width+'px';host.style.height=height+'px' },
    snapshot() {
      const canvas=host.querySelector('canvas')
      const geometry:string[]=[],materials:string[]=[]
      world?.scene.traverse((object:any)=>{if(object.geometry)geometry.push(object.geometry.uuid);if(object.material)materials.push(object.material.uuid)})
      return {resizes,bufferWrites,css:canvas?[canvas.clientWidth,canvas.clientHeight]:null,buffer:canvas?[canvas.width,canvas.height]:null,
        frames:Number(canvas?.dataset.frames??0),geometry,materials,target:world?.image?.uuid,error:world?.renderer.getContext().getError(),
        memory:world?{...world.renderer.info.memory}:null}
    },
    dispose() { root.unmount();host.remove();FiberSceneRenderer.prototype.resize=original;return {...world?.renderer.info.memory} },
  }
}
