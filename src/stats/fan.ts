import { normalQuantile } from './distributions'

export const FAN_LEVELS = [0.5, 0.8, 0.95] as const
export type FanLevel = (typeof FAN_LEVELS)[number]

/** z such that a normal forecast lies within ±z·σ of its centre with probability `level`. */
export const zFor = (level: number) => normalQuantile((1 + level) / 2)

export interface FanRow { t: number; center: number; lo: Record<number, number>; hi: Record<number, number>; row: number }

/** Why a row's intervals are inconsistent (a prediction interval must contain the centre; wider levels must contain narrower ones), or null. */
export function fanIssue(r: Pick<FanRow, 'center' | 'lo' | 'hi'>, levels: readonly number[] = FAN_LEVELS): string | null {
  const sorted = [...levels].sort((a, b) => a - b)
  for (const lv of sorted) {
    if (!Number.isFinite(r.lo[lv]) || !Number.isFinite(r.hi[lv])) return `${Math.round(lv * 100)}% 구간의 하한·상한이 숫자가 아닙니다.`
    if (r.lo[lv] > r.center || r.hi[lv] < r.center) return `${Math.round(lv * 100)}% 구간이 예측 중심값을 포함하지 않습니다.`
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (r.lo[b] > r.lo[a] || r.hi[b] < r.hi[a]) return `${Math.round(b * 100)}% 구간이 ${Math.round(a * 100)}% 구간을 포함하지 않습니다.`
  }
  return null
}

/** Normal-theory intervals: centre ± z(level)·σ for each level. */
export function bandsFromSigma(center: number, sigma: number, levels: readonly number[] = FAN_LEVELS) {
  const lo: Record<number, number> = {}
  const hi: Record<number, number> = {}
  for (const lv of levels) { lo[lv] = center - zFor(lv) * sigma; hi[lv] = center + zFor(lv) * sigma }
  return { lo, hi }
}

/** Forces the intervals to nest around the centre by widening inner-to-outer where needed. */
export function repairFan(r: Pick<FanRow, 'center' | 'lo' | 'hi'>, levels: readonly number[] = FAN_LEVELS) {
  const sorted = [...levels].sort((a, b) => a - b)
  const lo: Record<number, number> = {}
  const hi: Record<number, number> = {}
  let l = r.center
  let h = r.center
  for (const lv of sorted) {
    l = Math.min(l, Number.isFinite(r.lo[lv]) ? r.lo[lv] : l)
    h = Math.max(h, Number.isFinite(r.hi[lv]) ? r.hi[lv] : h)
    lo[lv] = l
    hi[lv] = h
  }
  return { lo, hi }
}
