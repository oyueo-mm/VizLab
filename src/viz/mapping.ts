import type { DataTable } from '../data/table'
import type { Mapping, RoleSpec } from './types'

const typeLabel = { number: '숫자형', category: '범주형' } as const

/** Fills roles in declaration order with the first unused column of the right type. */
export function autoMapping(roles: readonly RoleSpec[], table: DataTable, previous?: Mapping): Mapping {
  const used = new Set<string>()
  const out: Mapping = {}
  const has = (name: unknown, type: string) => typeof name === 'string' && table.columns.some((c) => c.name === name && c.type === type)
  // Keep still-valid choices from the previous mapping (e.g. after a cell edit or a compatible dataset switch).
  if (previous) {
    for (const role of roles) {
      const prev = previous[role.key]
      if (role.multiple && Array.isArray(prev)) {
        const kept = prev.filter((n) => has(n, role.type) && !used.has(n))
        if (kept.length >= role.multiple.min) { out[role.key] = kept; kept.forEach((n) => used.add(n)) }
      } else if (typeof prev === 'string' && has(prev, role.type) && !used.has(prev)) {
        out[role.key] = prev
        used.add(prev)
      } else if (prev === null && !role.required && role.key in previous) out[role.key] = null
    }
  }
  for (const role of roles) {
    if (role.key in out) continue
    const free = table.columns.filter((c) => c.type === role.type && !used.has(c.name)).map((c) => c.name)
    if (role.multiple) {
      const pick = free.slice(0, role.multiple.max ?? free.length)
      out[role.key] = pick
      pick.forEach((n) => used.add(n))
    } else if (role.required || role.auto) {
      out[role.key] = free[0] ?? null
      if (free[0]) used.add(free[0])
    } else out[role.key] = null
  }
  return out
}

/** Why a table cannot drive the chart at all (independent of the current mapping), or null when it can. */
export function incompatibility(roles: readonly RoleSpec[], table: DataTable): string | null {
  if (!table.rows.length) return '데이터 행이 없습니다.'
  for (const type of ['number', 'category'] as const) {
    const need = roles.filter((r) => r.required && r.type === type).reduce((s, r) => s + (r.multiple ? r.multiple.min : 1), 0)
    const have = table.columns.filter((c) => c.type === type).length
    if (need > have) return `${typeLabel[type]} 열이 ${need}개 이상 필요하지만 ${have}개뿐입니다.`
  }
  return null
}

/** Problems with the current mapping, in Korean, empty when the chart can render. */
export function mappingErrors(roles: readonly RoleSpec[], table: DataTable, mapping: Mapping): string[] {
  const base = incompatibility(roles, table)
  if (base) return [base]
  const errors: string[] = []
  for (const role of roles) {
    const value = mapping[role.key]
    if (role.multiple) {
      const list = Array.isArray(value) ? value : []
      const valid = list.filter((n) => table.columns.some((c) => c.name === n && c.type === role.type))
      if (valid.length < role.multiple.min) errors.push(`‘${role.label}’에 ${typeLabel[role.type]} 열을 ${role.multiple.min}개 이상 선택하세요.`)
    } else if (typeof value === 'string') {
      const col = table.columns.find((c) => c.name === value)
      if (!col) errors.push(`‘${role.label}’에 지정한 열 ‘${value}’이(가) 없습니다.`)
      else if (col.type !== role.type) errors.push(`‘${role.label}’에는 ${typeLabel[role.type]} 열이 필요합니다.`)
    } else if (role.required) errors.push(`‘${role.label}’에 사용할 열을 선택하세요.`)
  }
  return errors
}

export const roleColumn = (mapping: Mapping, key: string) => {
  const v = mapping[key]
  return typeof v === 'string' ? v : null
}

export const roleColumns = (mapping: Mapping, key: string) => {
  const v = mapping[key]
  return Array.isArray(v) ? v : []
}
