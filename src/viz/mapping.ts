import type { ColumnType, DataTable } from '../data/table'
import type { Mapping, RoleSpec } from './types'

const typeLabel: Record<ColumnType, string> = { number: '숫자형', category: '범주형', date: '날짜형' }

/** Column types that can fill a role, preferred type first. */
export const roleTypes = (role: RoleSpec): ColumnType[] => (role.accept ? [role.type, ...role.accept.filter((t) => t !== role.type)] : [role.type])
export const roleTypeLabel = (role: RoleSpec) => roleTypes(role).map((t) => typeLabel[t]).join(' 또는 ')

/** Fills roles in declaration order with the first unused column of an accepted type (preferred type first). */
export function autoMapping(roles: readonly RoleSpec[], table: DataTable, previous?: Mapping): Mapping {
  const used = new Set<string>()
  const out: Mapping = {}
  const has = (name: unknown, role: RoleSpec) => typeof name === 'string' && table.columns.some((c) => c.name === name && roleTypes(role).includes(c.type))
  // Keep still-valid choices from the previous mapping (e.g. after a cell edit or a compatible dataset switch).
  if (previous) {
    for (const role of roles) {
      const prev = previous[role.key]
      if (role.multiple && Array.isArray(prev)) {
        const kept = prev.filter((n) => has(n, role) && !used.has(n))
        if (kept.length >= role.multiple.min) { out[role.key] = kept; kept.forEach((n) => used.add(n)) }
      } else if (typeof prev === 'string' && has(prev, role) && !used.has(prev)) {
        out[role.key] = prev
        used.add(prev)
      } else if (prev === null && !role.required && role.key in previous) out[role.key] = null
    }
  }
  for (const role of roles) {
    if (role.key in out) continue
    // Preferred type first, then the other accepted types, each in column order.
    let free = roleTypes(role).flatMap((t) => table.columns.filter((c) => c.type === t && !used.has(c.name)).map((c) => c.name))
    // A name hint (alternatives separated by "|") moves matching columns to the front without changing the order of the rest.
    if (role.prefer) {
      const hints = role.prefer.toLowerCase().split('|')
      const hit = (n: string) => hints.some((h) => n.toLowerCase().includes(h))
      free = [...free.filter(hit), ...free.filter((n) => !hit(n))]
    }
    if (role.multiple) {
      const pick = free.slice(0, role.multiple.max ?? free.length)
      out[role.key] = pick
      pick.forEach((n) => used.add(n))
    } else if (role.required || role.auto || role.prefer) {
      // An optional role with a name hint is only filled by a column that matches the hint, so it never swallows an unrelated column.
      const optionalHint = !role.required && role.prefer
      const hints = optionalHint ? role.prefer!.toLowerCase().split('|') : []
      const pick = optionalHint ? free.find((n) => hints.some((h) => n.toLowerCase().includes(h))) : free[0]
      out[role.key] = pick ?? null
      if (pick) used.add(pick)
    } else out[role.key] = null
  }
  return out
}

const TYPES: ColumnType[] = ['number', 'category', 'date']

/**
 * Why a table cannot drive the chart at all (independent of the current mapping), or null when it can.
 * Required roles are matched to columns by type (Hall's condition over every set of column types), so a role that
 * accepts "date or number" correctly shares columns with a role that needs a number.
 */
export function incompatibility(roles: readonly RoleSpec[], table: DataTable): string | null {
  return incompatibilityFromSlots(slotsOf(roles), table)
}

/** A required column slot of a chart: the column types that can fill it. */
export type Slot = ColumnType[]

/** The required slots of a chart's roles (a multi-column role contributes its minimum count). */
export const slotsOf = (roles: readonly RoleSpec[]): Slot[] => roles.filter((r) => r.required).flatMap((r) => Array.from({ length: r.multiple ? r.multiple.min : 1 }, () => roleTypes(r)))

/**
 * The structural check on its own, from slots only — no chart module is needed, so the comparison lab can judge every chart's
 * compatibility with the shared table before that chart's code has been loaded (see viz/needs.ts).
 */
export function incompatibilityFromSlots(slots: readonly Slot[], table: DataTable): string | null {
  if (!table.rows.length) return '데이터 행이 없습니다.'
  for (let mask = 1; mask < 1 << TYPES.length; mask++) {
    const set = TYPES.filter((_, i) => mask & (1 << i))
    const need = slots.filter((s) => s.every((t) => set.includes(t))).length
    const have = table.columns.filter((c) => set.includes(c.type)).length
    if (need > have) {
      const names = set.map((t) => typeLabel[t]).join('·')
      return `${names} 열이 ${need}개 이상 필요하지만 ${have}개뿐입니다.`
    }
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
    const ok = (name: string) => table.columns.some((c) => c.name === name && roleTypes(role).includes(c.type))
    if (role.multiple) {
      const list = Array.isArray(value) ? value : []
      const valid = list.filter(ok)
      if (valid.length < role.multiple.min) errors.push(`‘${role.label}’에 ${roleTypeLabel(role)} 열을 ${role.multiple.min}개 이상 선택하세요.`)
    } else if (typeof value === 'string') {
      const col = table.columns.find((c) => c.name === value)
      if (!col) errors.push(`‘${role.label}’에 지정한 열 ‘${value}’이(가) 없습니다.`)
      else if (!roleTypes(role).includes(col.type)) errors.push(`‘${role.label}’에는 ${roleTypeLabel(role)} 열이 필요합니다.`)
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
