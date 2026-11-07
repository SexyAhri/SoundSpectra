import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { useVisualFrame } from './runtime'

export function TransitionCamera(){
  const camera=useThree(s=>s.camera),direction=useMemo(()=>new Vector3(),[])
  useVisualFrame(({transition,reduced})=>{
    if(!transition?.travel||reduced)return
    camera.getWorldDirection(direction)
    // Each rig moves along its own optical axis. Never interpolate unrelated cameras.
    camera.position.addScaledVector(direction,transition.travel*3.2)
    camera.updateMatrixWorld()
  },-2.5)
  return null
}
