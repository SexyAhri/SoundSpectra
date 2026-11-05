import { useRef,useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ChoiceSelect } from '@/components/ui/choice-select'
import type { WallpaperDepthSettings } from '../spectrum/model'
import { saveDepthImage,useDepthImage } from './image-store'
import './wallpaper-depth.css'

export function WallpaperDepthControls({settings,onChange,disabled}:{settings:WallpaperDepthSettings;onChange:(value:WallpaperDepthSettings)=>void;disabled:boolean}){
 const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 const image=useDepthImage(settings.revision),current=useRef(settings);current.current=settings
 const importFile=async(file:File)=>{
   if(busy)return;setBusy(true);setError(null)
   try{const value=await saveDepthImage(file);onChange({...current.current,enabled:true,revision:value.revision})}
   catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}
 }
 return <section className="wallpaper-depth-controls" aria-label="立体壁纸">
   <div className="wallpaper-depth-heading"><label htmlFor="wallpaper-depth-switch">立体壁纸 <small>分层视差</small></label><Switch id="wallpaper-depth-switch" aria-label="立体壁纸" checked={settings.enabled} disabled={disabled||busy||!image.image} onCheckedChange={enabled=>onChange({...settings,enabled})}/>
     <Button size="sm" variant="ghost" disabled={disabled||busy} onClick={()=>input.current?.click()}><ImagePlus size={14}/>{busy?'正在导入…':'选择图片'}</Button></div>
   <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label="立体壁纸图片文件" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importFile(file)}}/>
   {settings.revision&&<div className="wallpaper-depth-tuning"><label>视差强度 <output>{Math.round(settings.amount)}%</output><Slider aria-label="壁纸视差强度" value={[settings.amount]} min={0} max={100} step={1} disabled={disabled||busy||!settings.enabled} onValueChange={([amount])=>onChange({...settings,amount})}/></label>
     <ChoiceSelect label="壁纸构图" value={settings.profile} disabled={disabled||busy} options={[{value:'landscape',label:'山水远景'},{value:'left-foreground',label:'左侧近景'}]} onChange={profile=>onChange({...settings,profile:profile as WallpaperDepthSettings['profile']})}/></div>}
   <p>{settings.revision?'移动鼠标体验轻微景深；随“显示到桌面”一起启用。':'选择一张图片，保留原画并添加轻微视差。'}</p>
   {(error||image.error)&&<p role="alert">{error??image.error}</p>}
 </section>
}
