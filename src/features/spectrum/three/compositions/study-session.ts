import { AudioFeatureTimeline } from '../../audio-feature-timeline'
import type { MusicAnalysis } from '../../music-analysis'
import { studySettings } from '../../visual-study'
import { SceneMotion } from '../motion'
import { FiberSceneRenderer } from '../r3f/fiber-renderer'
import { compositions, type CompositionId } from './presets'
import type { SceneFocus } from '../../scene-focus'

export type StudyLevel = 'sequence' | 'quiet' | 'normal' | 'strong'
export function compositionAnalysis(sequence: number, level: StudyLevel): MusicAnalysis {
  const t=sequence*1024/48000, part=t%24
  const section=level==='sequence'?(part<6?'quiet':part<14?'normal':part<20?'strong':'quiet'):level
  const strength=section==='quiet'?.018:section==='normal'?.085:.18
  const pulse=Math.exp(-((t+.1)%.6)*15)
  const rms=strength*(.72+.28*pulse)
  const bands=[.34+pulse*.45,.27+pulse*.25,.38+.12*Math.sin(t*.7),.3+.13*Math.sin(t*.43),.16,.1+.08*Math.sin(t*1.3)]
  return {rms,bands,spectrum:Array.from({length:48},(_,i)=>bands[Math.floor(i/8)]*(.7+.3*Math.sin(i*.71+t*.4)**2)),skin:[],
    sourceRevision:1,streamId:1,sequence,samplePosition:sequence*1024,sampleRate:48000}
}
export function studySection(time:number){ const t=time%24;return t<6?'静段 · 0–6s':t<14?'普通段 · 6–14s':t<20?'强段 · 14–20s':'收束 · 20–24s' }
export class CompositionStudy {
  readonly world: FiberSceneRenderer
  readonly motion = new SceneMotion()
  readonly timeline = new AudioFeatureTimeline()
  settings
  time=0
  reduced=false
  reading=false
  level:StudyLevel='sequence'
  private sequence=0
  private audio=compositionAnalysis(0,'sequence')
  constructor(readonly canvas:HTMLCanvasElement,public id:CompositionId,readonly errors:string[]=[]){
    this.world=new FiberSceneRenderer(canvas,error=>errors.push(String(error)))
    this.settings=studySettings(compositions[id].effect,'immersive')
    this.settings.music.fieldPalette='iris'
    this.world.setComposition(id)
  }
  async resize(){await this.world.resize(this.settings,1)}
  select(id:CompositionId){
    this.id=id
    const mode=this.settings.sceneMode
    this.settings=studySettings(compositions[id].effect,mode)
    this.settings.music.fieldPalette='iris'
    this.world.setComposition(id)
    return this.resize()
  }
  step(dt:number){
    dt=Math.max(0,Math.min(.1,dt));this.time+=dt
    while(this.sequence*1024/48000<=this.time+1e-8){
      this.audio=compositionAnalysis(this.sequence++,this.level)
      this.timeline.push(this.audio,this.audio.samplePosition!/48)
    }
    this.motion.step(this.audio,dt,this.settings.music,this.reduced,this.timeline.sample(this.time*1000,this.settings.music))
    const focus:SceneFocus|undefined=this.reading?{bounds:{x:.1,y:.39,width:.43,height:.23},lineKey:'composition-reading',revision:1,backgroundOpacity:100}:undefined
    this.world.draw(this.motion,this.settings,this.reduced,dt,focus)
  }
  dispose(){this.world.dispose();return {...this.world.renderer.info.memory}}
}
