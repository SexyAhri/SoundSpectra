import { useRef,useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingToggle } from '@/components/ui/setting-toggle'
import { Parameter } from '@/components/ui/parameter'
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
   <SettingToggle className="card-enable" label="立体壁纸" description="随鼠标移动产生轻微视差" checked={settings.enabled} disabled={disabled||busy||!image.image} onChange={enabled=>onChange({...settings,enabled})}/>
   <Button className="wallpaper-image-action" variant="outline" disabled={disabled||busy} onClick={()=>input.current?.click()}><ImagePlus size={14}/>{busy?'正在导入…':settings.revision?'更换图片':'选择图片'}</Button>
   <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label="立体壁纸图片文件" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importFile(file)}}/>
   {settings.revision&&<div className="wallpaper-depth-tuning"><Parameter label="壁纸视差强度" value={settings.amount} min={0} max={100} disabled={disabled||busy||!settings.enabled} onChange={amount=>onChange({...settings,amount})}/>
     <label className="custom-color"><span>壁纸构图</span><ChoiceSelect label="壁纸构图" value={settings.profile} disabled={disabled||busy} options={[{value:'landscape',label:'山水远景'},{value:'left-foreground',label:'左侧近景'}]} onChange={profile=>onChange({...settings,profile:profile as WallpaperDepthSettings['profile']})}/></label></div>}
   {settings.revision&&<p>随“显示到桌面”一起启用。</p>}
   {(error||image.error)&&<p role="alert">{error??image.error}</p>}
 </section>
}
