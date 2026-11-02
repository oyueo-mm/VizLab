import type { HeroV7Key } from './heroFramesV7'
import type { Mark } from './heroFrames'

/** Loader for the v0.7 stage frames (a separate chunk: the multivariate, bundling, LIC and treemap engines stay out of the first load). */
let mod: typeof import('./heroFramesV7') | null = null
let loading: Promise<void> | null = null

export function loadHeroV7(): Promise<void> {
  loading ??= import('./heroFramesV7').then((m) => { mod = m })
  return loading
}
export const heroV7Ready = () => mod != null

/** Marks of a v0.7 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v7Frame = (key: HeroV7Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV7(key, cycle, w, h) : [])
