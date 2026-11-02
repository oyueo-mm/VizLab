import type { HeroV10Key } from './heroFramesV10'
import type { Mark } from './heroFrames'

/** Loader for the v1.0 stage frames (a separate chunk: the depth, topology and tree engines stay out of the first load). */
let mod: typeof import('./heroFramesV10') | null = null
let loading: Promise<void> | null = null

export function loadHeroV10(): Promise<void> {
  loading ??= import('./heroFramesV10').then((m) => { mod = m })
  return loading
}
export const heroV10Ready = () => mod != null

/** Marks of a v1.0 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v10Frame = (key: HeroV10Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV10(key, cycle, w, h) : [])
