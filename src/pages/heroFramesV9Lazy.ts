import type { HeroV9Key } from './heroFramesV9'
import type { Mark } from './heroFrames'

/** Loader for the v0.9 stage frames (a separate chunk: the set, sequence and layout engines stay out of the first load). */
let mod: typeof import('./heroFramesV9') | null = null
let loading: Promise<void> | null = null

export function loadHeroV9(): Promise<void> {
  loading ??= import('./heroFramesV9').then((m) => { mod = m })
  return loading
}
export const heroV9Ready = () => mod != null

/** Marks of a v0.9 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v9Frame = (key: HeroV9Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV9(key, cycle, w, h) : [])
