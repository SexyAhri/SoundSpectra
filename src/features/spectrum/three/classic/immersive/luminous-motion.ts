import { commonUniforms, flowDriver } from "../flow/shared";
// Names remain shared with the other classic scenes; no second audio clock.
export const luminousUniforms = commonUniforms;
export const luminousDriver = flowDriver;
export const luminousSource = `uniform float uSlowBass,uBassFast,uSlowMid,uFastHigh,uBeatGlow;`;
