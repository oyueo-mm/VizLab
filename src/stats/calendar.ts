/** Calendar arithmetic on plain dates (UTC, no time zone shifts). */

export interface YMD { y: number; m: number; d: number }

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export function daysInMonth(y: number, m: number) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/** Strict YYYY-MM-DD (also accepts YYYY/MM/DD and YYYY.MM.DD); null for impossible dates such as 2023-02-29. */
export function parseDate(text: string): YMD | null {
  const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(text)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
  return { y, m: mo, d }
}

const pad = (v: number) => String(v).padStart(2, '0')
export const formatDate = ({ y, m, d }: YMD) => `${y}-${pad(m)}-${pad(d)}`

/** Days since 1970-01-01. */
export const dayNumber = ({ y, m, d }: YMD) => Math.round(Date.UTC(y, m - 1, d) / 86400000)

export function fromDayNumber(n: number): YMD {
  const t = new Date(n * 86400000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: YMD) => new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()

export const daysInYear = (y: number) => (isLeapYear(y) ? 366 : 365)

/** Every date of a year in order. */
export function yearDates(y: number): YMD[] {
  const start = dayNumber({ y, m: 1, d: 1 })
  return Array.from({ length: daysInYear(y) }, (_, i) => fromDayNumber(start + i))
}

/**
 * Grid position of a date in a year calendar: column = week of the year (weeks start on
 * `weekStart`, 0 = Sunday, 1 = Monday) and row = position of the weekday within the week.
 */
export function calendarCell(date: YMD, weekStart: 0 | 1) {
  const jan1 = { y: date.y, m: 1, d: 1 }
  const offset = (weekday(jan1) - weekStart + 7) % 7
  const doy = dayNumber(date) - dayNumber(jan1)
  return { col: Math.floor((doy + offset) / 7), row: (weekday(date) - weekStart + 7) % 7 }
}
