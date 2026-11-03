import type { HeroV11Key } from './heroFramesV11'
import type { Mark } from './heroFrames'

/** Loader for the v1.1 stage frames (a separate chunk: the diagram, tree and cartogram engines stay out of the first load). */
let mod: typeof import('./heroFramesV11') | null = null
let loading: Promise<void> | null = null

export function loadHeroV11(): Promise<void> {
  loading ??= import('./heroFramesV11').then((m) => { mod = m })
  return loading
}
export const heroV11Ready = () => mod != null

/** Marks of a v1.1 stage, or nothing until the chunk has arrived (the home page redraws when it does). */
export const v11Frame = (key: HeroV11Key, cycle: number, w: number, h: number): Mark[] => (mod ? mod.buildV11(key, cycle, w, h) : [])
