import type { HeroV8Key } from './heroFramesV8'
import type { Mark } from './heroFrames'

/** Loader for the v0.8 stage frames (a separate chunk: the set, network, 3-D and sequence engines stay out of the first load). */
let mod: typeof import('./heroFramesV8') | null = null
let loading: Promise<void> | null = null

export function loadHeroV8(): Promise<void> {
  loading ??= import('./heroFramesV8').then((m) => { mod = m })
  return loading
}
export const heroV8Ready = () => mod != null

/** Marks of a v0.8 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v8Frame = (key: HeroV8Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV8(key, cycle, w, h) : [])
