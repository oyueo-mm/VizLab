import { sortNumbers } from './descriptive'

export type LetterRule = 'tukey' | 'proportion' | 'trustworthy' | 'full'

export const letterRules: { value: LetterRule; label: string; hint: string }[] = [
  { value: 'tukey', label: 'Tukey', hint: '⌊log₂ n⌋ − 3 단계' },
  { value: 'proportion', label: '이상치 비율', hint: '표본의 약 0.7%만 상자 밖에 남도록 단계를 정합니다' },
  { value: 'trustworthy', label: '신뢰할 수 있는 단계', hint: '꼬리 분위수 추정이 충분한 표본에 기대는 단계까지만 그립니다' },
  { value: 'full', label: '끝까지', hint: '최솟값·최댓값에 닿을 때까지 모두 그립니다' },
]

const LABELS = 'MFEDCBAZYXWVUTSRQPONMLKJIHG'.split('')
export const letterName = (level: number) => (level === 0 ? 'M' : LABELS[level] ?? `L${level}`)

/** Letter-value depths d₁ = (n + 1)/2 (the median), dᵢ₊₁ = (⌊dᵢ⌋ + 1)/2, down to depth 1 (the extremes). */
export function letterDepths(n: number): number[] {
  const out: number[] = []
  if (n < 1) return out
  let d = (n + 1) / 2
  out.push(d)
  while (d > 1 && out.length < 60) {
    d = (Math.floor(d) + 1) / 2
    out.push(d)
  }
  return out
}

/** Number of boxes (letter values beyond the median) drawn by a rule, never more than the data supports. */
export function boxCount(n: number, rule: LetterRule, p = 0.007): number {
  const max = Math.max(0, letterDepths(n).length - 1)
  if (n < 4) return Math.min(1, max)
  const lg = Math.floor(Math.log2(n))
  let k: number
  switch (rule) {
    case 'tukey': k = lg - 3; break
    case 'proportion': k = lg - Math.floor(Math.log2(Math.max(1, n * p))) + 1; break
    case 'trustworthy': k = Math.floor(Math.log2(n / (2.697 * 2.697))) + 1; break
    default: k = max
  }
  return Math.max(1, Math.min(max, k))
}

/** Order statistic at a (possibly half-integer) depth counted from the low end; fractional depths average the two neighbours. */
export function valueAtDepth(sorted: readonly number[], depth: number): number {
  const lo = sorted[Math.floor(depth) - 1]
  const hi = sorted[Math.ceil(depth) - 1]
  return (lo + hi) / 2
}

export interface LetterBox {
  level: number
  name: string
  depth: number
  lower: number
  upper: number
  /** Fraction of the data in each tail beyond this box, ≈ 2^−(level+1). */
  tail: number
}

export interface LetterValues {
  n: number
  median: number
  boxes: LetterBox[]
  /** Values outside the outermost box. */
  outliers: number[]
}

/** Letter values (Hofmann, Wickham & Kafadar 2017): nested boxes at the quartiles, eighths, sixteenths, … of the sorted sample. */
export function letterValues(values: readonly number[], boxes: number): LetterValues | null {
  const n = values.length
  if (!n) return null
  const s = sortNumbers(values)
  const depths = letterDepths(n)
  const k = Math.max(0, Math.min(boxes, depths.length - 1))
  const out: LetterBox[] = []
  for (let level = 1; level <= k; level++) {
    const depth = depths[level]
    out.push({ level, name: letterName(level), depth, lower: valueAtDepth(s, depth), upper: valueAtDepth(s, n + 1 - depth), tail: depth / n })
  }
  const lo = out.length ? out[out.length - 1].lower : s[0]
  const hi = out.length ? out[out.length - 1].upper : s[n - 1]
  return { n, median: valueAtDepth(s, depths[0]), boxes: out, outliers: out.length ? s.filter((v) => v < lo || v > hi) : [] }
}
