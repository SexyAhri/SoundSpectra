import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'
import { useEffect,useState } from 'react'

export interface DepthImage {dataUrl:string;revision:string;width:number;height:number}
async function decode(value:{dataUrl:string;revision:string}):Promise<DepthImage>{
 const image=new Image();image.src=value.dataUrl
 await image.decode().catch(()=>{throw new Error('无法读取壁纸，请重新选择图片。')})
 if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>100_000_000)throw new Error('图片尺寸过大。')
 return {...value,width:image.naturalWidth,height:image.naturalHeight}
}
async function browserStore(value?:DepthImage):Promise<DepthImage|undefined>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{
   const request=indexedDB.open('soundspectra-preview',1)
   request.onupgradeneeded=()=>request.result.createObjectStore('images')
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
 })
 try{return await new Promise((resolve,reject)=>{
   const transaction=db.transaction('images',value?'readwrite':'readonly'),store=transaction.objectStore('images')
   const request=value?store.put(value,'depth-wallpaper'):store.get('depth-wallpaper')
   transaction.oncomplete=()=>resolve(value??request.result)
   transaction.onerror=transaction.onabort=()=>reject(new Error('壁纸保存失败，请重试。'))
 })}finally{db.close()}
}
let cached:{revision:string;promise:Promise<DepthImage|null>}|undefined
export function readDepthImage(revision:string):Promise<DepthImage|null>{
 if(!revision)return Promise.resolve(null)
 if(cached?.revision===revision)return cached.promise
 const promise=(native?invoke<{dataUrl:string;revision:string}|null>('load_depth_image'):browserStore()).then(async value=>{
   if(!value)throw new Error('壁纸图片未找到，请重新选择。')
   if(value.revision!==revision)throw new Error('壁纸图片已变更，请重新选择。')
   return decode(value)
 })
 cached={revision,promise};promise.catch(()=>{if(cached?.promise===promise)cached=undefined})
 return promise
}
export async function saveDepthImage(file:File):Promise<DepthImage>{
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>32*1024*1024)throw new Error('请选择 32 MB 以内的 JPEG、PNG 或 WebP 图片。')
 const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file)})
 const decoded=await decode({dataUrl,revision:''})
 const revision=native?await invoke<string>('save_depth_image',{dataUrl}):Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('')
 const image={...decoded,revision}
 if(!native)await browserStore(image)
 cached={revision,promise:Promise.resolve(image)}
 return image
}
export function useDepthImage(revision:string){
 const [state,setState]=useState<{revision:string;image:DepthImage|null;error:string|null}>({revision:'',image:null,error:null})
 useEffect(()=>{let cancelled=false;void readDepthImage(revision).then(image=>{if(!cancelled)setState({revision,image,error:null})}).catch(error=>{if(!cancelled)setState({revision,image:null,error:error instanceof Error?error.message:String(error)})});return()=>{cancelled=true}},[revision])
 return state.revision===revision?{...state,loading:false}:{revision,image:null,error:null,loading:!!revision}
}
