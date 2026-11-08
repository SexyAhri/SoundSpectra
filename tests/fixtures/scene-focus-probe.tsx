import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {SceneFocusProvider,LyricSceneFocus,useSceneFocus,type SceneFocus} from '../../src/features/spectrum/scene-focus'

export function mountSceneFocusProbe(){
  const host=document.createElement('div');document.body.append(host)
  const root=createRoot(host),refs:({current:SceneFocus}|null)[]=[]
  const bounds={x:.2,y:.3,width:.4,height:.2}
  function Read({id}:{id:number}){refs[id]=useSceneFocus();return null}
  const render=(visible:boolean,lineKey='one')=>flushSync(()=>root.render(<>
    <SceneFocusProvider><Read id={0}/>{visible&&<LyricSceneFocus bounds={bounds} lineKey={lineKey} backgroundOpacity={30}/>}</SceneFocusProvider>
    <SceneFocusProvider><Read id={1}/></SceneFocusProvider>
  </>))
  render(true)
  return {render,read:()=>refs.map(ref=>structuredClone(ref!.current)),dispose(){flushSync(()=>root.unmount());host.remove()}}
}
