import { periodStart, type DatePeriod } from './datetime'

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number | null; row: number }

/** Why an open/high/low/close quadruple is impossible, or null when it is valid. */
export function ohlcIssue(o: number, h: number, l: number, c: number): string | null {
  if (![o, h, l, c].every(Number.isFinite)) return '시가·고가·저가·종가가 모두 숫자여야 합니다.'
  if (h < l) return '고가가 저가보다 낮습니다.'
  if (h < Math.max(o, c)) return '고가가 시가 또는 종가보다 낮습니다.'
  if (l > Math.min(o, c)) return '저가가 시가 또는 종가보다 높습니다.'
  return null
}

/** Rolls candles up to weekly / monthly / … candles: open of the first, close of the last, extremes of all, volume summed. */
export function aggregateCandles(candles: readonly Candle[], period: DatePeriod): Candle[] {
  const sorted = [...candles].sort((a, b) => a.t - b.t)
  if (period === 'day') return sorted
  const groups = new Map<number, Candle[]>()
  for (const c of sorted) {
    const key = periodStart(c.t, period)
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }
  return [...groups.entries()].map(([t, g]) => ({
    t, o: g[0].o, c: g[g.length - 1].c, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)),
    v: g.some((x) => x.v != null) ? g.reduce((s, x) => s + (x.v ?? 0), 0) : null, row: g[0].row,
  }))
}
