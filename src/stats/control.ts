/** Statistical process control: limits from the process's own variation, and signals from the standard run rules. */

export type ControlType = 'imr' | 'xbar' | 'p' | 'c'

export const controlTypes: { value: ControlType; label: string; hint: string }[] = [
  { value: 'imr', label: '개별값 I-MR', hint: '관측값 하나씩 측정한 연속형 데이터. σ는 이동범위 평균으로 추정합니다 (σ̂ = MR̄ / 1.128).' },
  { value: 'xbar', label: '평균 X̄-R', hint: '같은 부분군(예: 시간대별 5개)을 묶어 평균과 범위를 관리합니다. 부분군 열이 필요합니다.' },
  { value: 'p', label: '불량률 p', hint: '검사한 수 중 불량 개수의 비율. 검사 수가 다르면 한계가 점마다 달라집니다. 불량 수와 검사 수 열이 필요합니다.' },
  { value: 'c', label: '결함 수 c', hint: '단위당 결함 개수(푸아송 가정). 표본 크기가 같을 때 씁니다.' },
]

/** Constants for subgroup size n = 2…10: d₂ (mean range), A₂ (X̄ limits), D₃ and D₄ (range limits). */
export const CONSTANTS: Record<number, { d2: number; A2: number; D3: number; D4: number }> = {
  2: { d2: 1.128, A2: 1.88, D3: 0, D4: 3.267 }, 3: { d2: 1.693, A2: 1.023, D3: 0, D4: 2.574 }, 4: { d2: 2.059, A2: 0.729, D3: 0, D4: 2.282 },
  5: { d2: 2.326, A2: 0.577, D3: 0, D4: 2.114 }, 6: { d2: 2.534, A2: 0.483, D3: 0, D4: 2.004 }, 7: { d2: 2.704, A2: 0.419, D3: 0.076, D4: 1.924 },
  8: { d2: 2.847, A2: 0.373, D3: 0.136, D4: 1.864 }, 9: { d2: 2.97, A2: 0.337, D3: 0.184, D4: 1.816 }, 10: { d2: 3.078, A2: 0.308, D3: 0.223, D4: 1.777 },
}

export interface ControlLimits {
  /** Plotted statistic per point and its centre line, sigma and limits (arrays, because p-chart limits change with the sample size). */
  values: number[]
  center: number[]
  sigma: number[]
  ucl: number[]
  lcl: number[]
  /** A second panel (moving range or subgroup range) when the chart type has one. */
  range?: { values: number[]; center: number; ucl: number; lcl: number; label: string }
  label: string
}

const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length
const fill = (n: number, v: number) => new Array<number>(n).fill(v)

/** Individuals chart: centre x̄, σ̂ = MR̄/d₂(2), limits x̄ ± 3σ̂; moving-range chart with UCL = D₄·MR̄ (3.267·MR̄). Needs ≥ 2 values. */
export function individualsChart(x: readonly number[]): ControlLimits | null {
  if (x.length < 2) return null
  const mr = x.slice(1).map((v, i) => Math.abs(v - x[i]))
  const mrBar = mean(mr)
  const center = mean(x)
  const sigma = mrBar / CONSTANTS[2].d2
  const n = x.length
  return { values: [...x], center: fill(n, center), sigma: fill(n, sigma), ucl: fill(n, center + 3 * sigma), lcl: fill(n, center - 3 * sigma), label: '개별값', range: { values: [NaN, ...mr], center: mrBar, ucl: CONSTANTS[2].D4 * mrBar, lcl: 0, label: '이동범위 MR' } }
}

/** X̄–R chart for equal-size subgroups (2 ≤ n ≤ 10): limits X̿ ± A₂R̄ and range limits D₃R̄, D₄R̄. */
export function xbarChart(groups: readonly (readonly number[])[]): ControlLimits | null {
  const g = groups.filter((x) => x.length >= 2)
  if (!g.length) return null
  const size = Math.round(mean(g.map((x) => x.length)))
  const c = CONSTANTS[Math.max(2, Math.min(10, size))]
  const means = g.map(mean)
  const ranges = g.map((x) => Math.max(...x) - Math.min(...x))
  const grand = mean(means)
  const rBar = mean(ranges)
  const n = g.length
  return { values: means, center: fill(n, grand), sigma: fill(n, (c.A2 * rBar) / 3), ucl: fill(n, grand + c.A2 * rBar), lcl: fill(n, grand - c.A2 * rBar), label: '부분군 평균', range: { values: ranges, center: rBar, ucl: c.D4 * rBar, lcl: c.D3 * rBar, label: '부분군 범위 R' } }
}

/** p chart: p̄ = Σdefects / Σinspected, limits p̄ ± 3√(p̄(1 − p̄)/nᵢ) per point, clamped to [0, 1]. */
export function pChart(defects: readonly number[], inspected: readonly number[]): ControlLimits | null {
  const idx = defects.map((_, i) => i).filter((i) => inspected[i] > 0 && defects[i] >= 0 && defects[i] <= inspected[i])
  if (!idx.length) return null
  const pbar = idx.reduce((s, i) => s + defects[i], 0) / idx.reduce((s, i) => s + inspected[i], 0)
  const sigma = idx.map((i) => Math.sqrt((pbar * (1 - pbar)) / inspected[i]))
  return { values: idx.map((i) => defects[i] / inspected[i]), center: fill(idx.length, pbar), sigma, ucl: sigma.map((s) => Math.min(1, pbar + 3 * s)), lcl: sigma.map((s) => Math.max(0, pbar - 3 * s)), label: '불량률' }
}

/** c chart: c̄ ± 3√c̄ (Poisson), lower limit floored at 0. */
export function cChart(counts: readonly number[]): ControlLimits | null {
  const c = counts.filter((v) => Number.isFinite(v) && v >= 0)
  if (!c.length) return null
  const cbar = mean(c)
  const s = Math.sqrt(cbar)
  return { values: c, center: fill(c.length, cbar), sigma: fill(c.length, s), ucl: fill(c.length, cbar + 3 * s), lcl: fill(c.length, Math.max(0, cbar - 3 * s)), label: '결함 수' }
}

export type RuleId = 1 | 2 | 3 | 5

export const ruleLabels: Record<RuleId, string> = {
  1: '규칙 1: 관리한계(±3σ) 밖의 점',
  2: '규칙 2: 중심선 한쪽에 연속 9점',
  3: '규칙 3: 연속 6점이 계속 증가 또는 감소',
  5: '규칙 5: 연속 3점 중 2점이 같은 쪽 2σ 밖',
}

export interface Signal { index: number; rule: RuleId }

/**
 * Western Electric / Nelson run rules on the plotted statistic. Rule 1 uses the actual limits; the zone rules use each point's own σ
 * (so they also work for p charts). A signal means the process is probably not stable — not that a specification was missed.
 */
export function detectSignals(limits: Pick<ControlLimits, 'values' | 'center' | 'sigma' | 'ucl' | 'lcl'>, rules: readonly RuleId[] = [1, 2, 3, 5]): Signal[] {
  const { values: v, center: c, sigma: s, ucl, lcl } = limits
  const out: Signal[] = []
  const side = v.map((x, i) => Math.sign(x - c[i]))
  const z = v.map((x, i) => (s[i] > 0 ? (x - c[i]) / s[i] : 0))
  if (rules.includes(1)) v.forEach((x, i) => { if (x > ucl[i] || x < lcl[i]) out.push({ index: i, rule: 1 }) })
  if (rules.includes(2)) {
    for (let i = 8; i < v.length; i++) {
      const w = side.slice(i - 8, i + 1)
      if (w[0] !== 0 && w.every((q) => q === w[0])) for (let k = i - 8; k <= i; k++) if (!out.some((o) => o.index === k && o.rule === 2)) out.push({ index: k, rule: 2 })
    }
  }
  if (rules.includes(3)) {
    for (let i = 5; i < v.length; i++) {
      const w = v.slice(i - 5, i + 1)
      const up = w.every((x, k) => k === 0 || x > w[k - 1])
      const down = w.every((x, k) => k === 0 || x < w[k - 1])
      if (up || down) for (let k = i - 5; k <= i; k++) if (!out.some((o) => o.index === k && o.rule === 3)) out.push({ index: k, rule: 3 })
    }
  }
  if (rules.includes(5)) {
    for (let i = 2; i < v.length; i++) {
      for (const sg of [1, -1]) {
        const idx = [i - 2, i - 1, i].filter((k) => sg * z[k] > 2)
        if (idx.length >= 2 && sg * z[i] > 2) idx.forEach((k) => { if (!out.some((o) => o.index === k && o.rule === 5)) out.push({ index: k, rule: 5 }) })
      }
    }
  }
  return out.sort((a, b) => a.index - b.index || a.rule - b.rule)
}

/** Process capability against specification limits — a different thing from control limits. Cp = (USL − LSL)/6σ, Cpk = min(USL − μ, μ − LSL)/3σ. */
export function capability(mu: number, sigma: number, lsl: number | null, usl: number | null) {
  if (!(sigma > 0)) return { cp: null, cpk: null }
  const cp = lsl != null && usl != null ? (usl - lsl) / (6 * sigma) : null
  const up = usl != null ? (usl - mu) / (3 * sigma) : null
  const lo = lsl != null ? (mu - lsl) / (3 * sigma) : null
  const cpk = up != null && lo != null ? Math.min(up, lo) : up ?? lo
  return { cp, cpk }
}
