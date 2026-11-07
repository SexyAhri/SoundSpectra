import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { emptyNowPlaying } from '../desktop-card/use-now-playing'
import { defaults } from '../spectrum/model'
import { PerformanceProvider } from './runtime'
import { ShowPreview } from './preview'
import { exampleShow } from './model'
import { PerformancePanel } from './panel'
import '../../index.css'

function Lab(){
  const [show]=useState(exampleShow)
  return <PerformanceProvider info={emptyNowPlaying}><main style={{maxWidth:1120,margin:'24px auto',padding:20,color:'#d5e1df'}}>
    <h1 style={{fontSize:24,fontWeight:450}}>回声航线</h1><p style={{fontSize:12,opacity:.65}}>三种转场 · 两种演奏方式 · 绝对时间恢复。独立模拟预演，不控制本机音乐。</p>
    <ShowPreview show={show}/><PerformancePanel settings={{...defaults,effect:'tidal_knot'}} region="primary"/>
  </main></PerformanceProvider>
}
document.body.style.background='#0c141c'
createRoot(document.getElementById('root')!).render(<Lab/> )
