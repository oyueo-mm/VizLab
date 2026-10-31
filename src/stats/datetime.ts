import * as d3 from 'd3'
import { daysInMonth } from './calendar'

/**
 * Date/time handling for date columns.
 *
 * Time-zone policy: a cell without an offset ("2024-03-15", "2024-03-15T09:30") is a *floating* local
 * time — it is read as UTC wall-clock time and displayed unchanged, so a chart never shifts a value
 * because of the viewer's time zone or daylight-saving rules. A cell with `Z` or `±hh:mm` is a real
 * instant and is converted to UTC. All arithmetic is UTC, so a day is always exactly 86 400 000 ms.
 */
export type DateFormat = 'iso' | 'mdy' | 'dmy' | 'ymd-dot'

export const dateFormats: { value: DateFormat; label: string; example: string }[] = [
  { value: 'iso', label: 'ISO 8601 (년-월-일)', example: '2024-03-15' },
  { value: 'ymd-dot', label: '년.월.일 / 년/월/일', example: '2024.03.15' },
  { value: 'mdy', label: '월/일/년', example: '03/15/2024' },
  { value: 'dmy', label: '일/월/년', example: '15/03/2024' },
]

export const DAY_MS = 86400000

const pad = (v: number, n = 2) => String(v).padStart(n, '0')

function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null
  const t = Date.UTC(y, mo - 1, d, h, mi, s)
  // Date.UTC maps years 0–99 onto 1900–1999; reject so "0024-01-01" is not silently misread.
  return y < 100 ? null : t
}

const ISO = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?\s*$/
const YMD = /^\s*(\d{4})[./](\d{1,2})[./](\d{1,2})\s*$/
const SLASH = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/

/**
 * Epoch milliseconds (UTC) of a date or date-time string, or null if it is not a real calendar date.
 * `iso` accepts ISO 8601 plus Y.M.D / Y/M/D; `mdy` and `dmy` accept day-first or month-first numeric dates.
 * Ambiguous numeric dates such as "03/04/2024" are never guessed: they need an explicit `mdy` or `dmy`.
 */
export function parseDateTime(text: string, format: DateFormat = 'iso'): number | null {
  if (format === 'iso' || format === 'ymd-dot') {
    const iso = ISO.exec(text)
    if (iso) {
      const t = utc(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0))
      if (t == null) return null
      const tz = iso[7]
      if (!tz || tz === 'Z') return t
      const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz)!
      return t - (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000
    }
    const ymd = YMD.exec(text)
    return ymd ? utc(+ymd[1], +ymd[2], +ymd[3]) : null
  }
  const m = SLASH.exec(text)
  if (!m) return null
  return format === 'mdy' ? utc(+m[3], +m[1], +m[2]) : utc(+m[3], +m[2], +m[1])
}

/** True when the text is a numeric day/month date whose reading depends on the format (both parts ≤ 12 and different). */
export function isAmbiguousDate(text: string): boolean {
  const m = SLASH.exec(text)
  return !!m && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2]
}

/** Date cell → epoch ms. Cells are stored as ISO strings; numbers are accepted as epoch ms. */
export function toTime(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim() !== '') return parseDateTime(cell)
  return null
}

export const hasClock = (ms: number) => ms % DAY_MS !== 0

/** ISO 8601 text: date only at midnight, otherwise YYYY-MM-DDTHH:mm. */
export function formatISO(ms: number, forceTime = false): string {
  const d = new Date(ms)
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return forceTime || hasClock(ms) ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** Human-readable Korean date for tooltips ("2024. 3. 15." or with time). */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`
  return hasClock(ms) ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** Adds calendar months in UTC, clamping to the month end (Jan 31 + 1 month = Feb 29 in a leap year). */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months
  const y = Math.floor(total / 12)
  const m = total - y * 12 + 1
  const day = Math.min(d.getUTCDate(), daysInMonth(y, m))
  return Date.UTC(y, m - 1, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
}

/** Whole days between two instants (UTC, so DST never makes a day 23 or 25 hours long). */
export const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY_MS)

/** Tick positions (epoch ms) at calendar boundaries chosen for the span. */
export function dateTicks(lo: number, hi: number, count = 6): number[] {
  return d3.scaleUtc().domain([new Date(lo), new Date(hi)]).ticks(count).map((d) => d.getTime())
}

/**
 * Korean tick labels matched to the tick spacing: years, "2024.1" / "3월", "3/15", or "09:00". The first tick and every
 * January (or midnight) tick also carry the larger unit so the reader never loses the year or the day.
 */
export function dateTickFormat(lo: number, hi: number, count = 6): (ms: number) => string {
  const ticks = dateTicks(lo, hi, count)
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i])
  const step = gaps.length ? Math.min(...gaps) : hi - lo
  const first = ticks[0]
  return (ms) => {
    const d = new Date(ms)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    if (step >= 330 * DAY_MS) return String(y)
    if (step >= 27 * DAY_MS) return m === 1 || ms === first ? `${y}.${m}` : `${m}월`
    if (step >= DAY_MS) return `${m}/${day}`
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `${m}/${day}` : hm
  }
}

export type DatePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** Start (epoch ms) of the period containing `ms`; weeks start on Monday. */
export function periodStart(ms: number, period: DatePeriod): number {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const mo = d.getUTCMonth()
  switch (period) {
    case 'day': return Date.UTC(y, mo, d.getUTCDate())
    case 'week': { const day = (d.getUTCDay() + 6) % 7; return Date.UTC(y, mo, d.getUTCDate() - day) }
    case 'month': return Date.UTC(y, mo, 1)
    case 'quarter': return Date.UTC(y, mo - (mo % 3), 1)
    default: return Date.UTC(y, 0, 1)
  }
}
