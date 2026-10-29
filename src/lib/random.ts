/** Seeded pseudo-random generator (mulberry32) so every dataset is reproducible. */
export interface Rng {
  (): number
  normal(mean?: number, sd?: number): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  const rng = next as Rng
  // Box–Muller transform; the second variate is cached for the next call.
  rng.normal = (mean = 0, sd = 1) => {
    if (spare !== null) {
      const v = spare
      spare = null
      return mean + sd * v
    }
    let u = 0
    while (u === 0) u = next()
    const v = next()
    const r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v)
    return mean + sd * r * Math.cos(2 * Math.PI * v)
  }
  rng.int = (min, max) => min + Math.floor(next() * (max - min + 1))
  rng.pick = (items) => items[Math.floor(next() * items.length)]
  return rng
}

export const round = (value: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
