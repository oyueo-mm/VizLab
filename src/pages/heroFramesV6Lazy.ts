import type { HeroV6Key } from './heroFramesV6'
import type { Mark } from './heroFrames'

/** Loader for the v0.6 stage frames (a separate chunk: the graph, reliability, finance and fractal engines stay out of the first load). */
let mod: typeof import('./heroFramesV6') | null = null
let loading: Promise<void> | null = null

export function loadHeroV6(): Promise<void> {
  loading ??= import('./heroFramesV6').then((m) => { mod = m })
  return loading
}
export const heroV6Ready = () => mod != null

/** Marks of a v0.6 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v6Frame = (key: HeroV6Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV6(key, cycle, w, h) : [])
