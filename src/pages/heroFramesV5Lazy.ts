import type { HeroV5Key } from './heroFramesV5'
import type { Mark } from './heroFrames'

/** Loader for the v0.5 stage frames (a separate chunk, so the home page does not carry the spatial, survival, finance and set engines up front). */
let mod: typeof import('./heroFramesV5') | null = null
let loading: Promise<void> | null = null

export function loadHeroV5(): Promise<void> {
  loading ??= import('./heroFramesV5').then((m) => { mod = m })
  return loading
}
export const heroV5Ready = () => mod != null

/** Marks of a v0.5 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v5Frame = (key: HeroV5Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV5(key, cycle, w, h) : [])
