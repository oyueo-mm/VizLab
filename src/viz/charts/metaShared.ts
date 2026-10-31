import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { normalQuantile } from '../../stats/distributions'
import { roleColumn } from '../mapping'
import type { Mapping, RoleSpec } from '../types'

export interface StudyRow {
  row: number
  name: string
  /** Effect on the analysis scale (natural log when the effect is a ratio) and its standard error. */
  effect: number
  se: number
  /** Effect and confidence limits on the display scale (the ratio itself for ratios). */
  raw: number
  rawLo: number
  rawHi: number
}

export type EffectScale = 'ratio' | 'difference'

export const studyRoles: RoleSpec[] = [
  { key: 'label', label: '연구 이름', type: 'category', auto: true },
  { key: 'effect', label: '효과 크기 (OR·RR·평균차)', type: 'number', required: true, prefer: '효과|effect' },
  { key: 'lo', label: '신뢰구간 하한', type: 'number', prefer: '하한|lower|low' },
  { key: 'hi', label: '신뢰구간 상한', type: 'number', prefer: '상한|upper|high' },
  { key: 'se', label: '표준오차 (선택)', type: 'number', prefer: '표준오차|stderr|std err' },
]

const Z95 = normalQuantile(0.975)

/**
 * Reads studies. The standard error comes from the confidence limits ((hi − lo)/2z, on the log scale for ratios) when both are present and
 * otherwise from the standard-error column, which for ratios must already be the standard error of the log ratio. Rows that cannot give a
 * positive standard error (and, for ratios, rows with non-positive values) are skipped and counted.
 */
export function readStudies(table: DataTable, mapping: Mapping, scale: EffectScale) {
  const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const [ni, ei, li, hi, si] = ['label', 'effect', 'lo', 'hi', 'se'].map(ix)
  const out: StudyRow[] = []
  let skipped = 0
  if (ei < 0) return { studies: out, skipped, hasInterval: false }
  const tx = (v: number) => (scale === 'ratio' ? Math.log(v) : v)
  table.rows.forEach((r, row) => {
    const raw = toNumber(r[ei])
    if (raw == null || (scale === 'ratio' && !(raw > 0))) { if (r.some((c) => c != null && c !== '')) skipped++; return }
    const lo = li >= 0 ? toNumber(r[li]) : null
    const up = hi >= 0 ? toNumber(r[hi]) : null
    let se: number | null = null
    if (lo != null && up != null && (scale !== 'ratio' || (lo > 0 && up > 0)) && up > lo) se = (tx(up) - tx(lo)) / (2 * Z95)
    else if (si >= 0) se = toNumber(r[si])
    if (se == null || !(se > 0)) { skipped++; return }
    const e = tx(raw)
    const back = (v: number) => (scale === 'ratio' ? Math.exp(v) : v)
    out.push({ row, name: ni >= 0 ? toLabel(r[ni]) || `연구 ${row + 1}` : `연구 ${row + 1}`, effect: e, se, raw, rawLo: lo != null && up != null && up > lo ? lo : back(e - Z95 * se), rawHi: lo != null && up != null && up > lo ? up : back(e + Z95 * se) })
  })
  return { studies: out, skipped, hasInterval: li >= 0 && hi >= 0 }
}

/** Log-axis tick values (1, 2, 5 × 10ᵏ) inside [lo, hi]. */
export function ratioTicks(lo: number, hi: number) {
  const out: number[] = []
  for (let p = Math.floor(Math.log10(lo)) - 1; p <= Math.ceil(Math.log10(hi)) + 1; p++) for (const m of [1, 2, 5]) { const v = m * 10 ** p; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v) }
  return out.length >= 3 ? out : [lo, 1, hi].filter((v, i, a) => v >= lo && v <= hi && a.indexOf(v) === i)
}
