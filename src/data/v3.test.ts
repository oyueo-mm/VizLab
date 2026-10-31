import { describe, expect, it } from 'vitest'
import { bandsFromSigma, fanIssue } from '../stats/fan'
import { buildAlluvial, stageTotals } from '../stats/alluvial'
import { buildNetwork } from '../stats/network'
import { ohlcIssue } from '../stats/ohlc'
import { curveIssue, prevalence, type Scored } from '../stats/roc'
import { formatCsv, formatJson, inferColumns, normalizeDate, parseCsv, parseJson } from './csv'
import { allocate } from './datasetsV3'
import { generateDataset } from './datasets'
import { invalidDateCells, numbers, templateRow, toLabel, toNumber, toTime, type DataTable } from './table'

const col = (t: DataTable, name: string) => t.rows.map((r) => r[t.columns.findIndex((c) => c.name === name)])

describe('largest-remainder allocation', () => {
  it('always adds up to the total', () => {
    for (const [total, w] of [[10, [1, 1, 1]], [7, [0.5, 0.3, 0.2]], [100, [0.333, 0.333, 0.334]], [3, [0, 0, 1]]] as const) {
      const parts = allocate(total, w)
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total)
      expect(parts.every((v) => Number.isInteger(v) && v >= 0)).toBe(true)
    }
  })
})

describe('v0.3 datasets', () => {
  it('are reproducible from the seed and respect their size', () => {
    for (const id of ['visits-dated', 'sensors', 'ohlc', 'forecast', 'pca-students', 'stage-flow', 'network', 'scores', 'scores-imbalanced', 'survey', 'trajectory', 'big-groups'] as const) {
      expect(generateDataset(id, 11, undefined)).toEqual(generateDataset(id, 11, undefined))
    }
    expect(generateDataset('visits-dated', 1, 30).rows.length).toBe(90)
    expect(generateDataset('ohlc', 1, 25).rows.length).toBe(25)
    expect(generateDataset('network', 1, 30).rows.length).toBeGreaterThan(30)
  })

  it('date columns hold real, ordered calendar dates', () => {
    const v = generateDataset('visits-dated', 3, 400)
    const dates = col(v, '날짜').map((c) => toTime(c))
    expect(dates.every((d) => d != null)).toBe(true)
    expect(invalidDateCells(v)).toBe(0)
    // 400 days from 2024-01-01 crosses the 2024 leap day
    expect(new Set(col(v, '날짜')).has('2024-02-29')).toBe(true)
    const s = generateDataset('sensors', 3, 48)
    expect(String(s.rows[0][0])).toBe('2024-03-01T00:00')
    expect(String(s.rows[4][0])).toBe('2024-03-01T01:00')
    expect(generateDataset('daily').columns[0]).toEqual({ name: '날짜', type: 'date' })
  })

  it('OHLC data is valid on every row, skips weekends and keeps the close continuous', () => {
    const t = generateDataset('ohlc', 5, 200)
    t.rows.forEach((r) => expect(ohlcIssue(r[1] as number, r[2] as number, r[3] as number, r[4] as number)).toBeNull())
    for (const d of col(t, '날짜')) expect([0, 6]).not.toContain(new Date(toTime(d)!).getUTCDay())
    expect(col(t, '거래량').every((v) => (v as number) > 0)).toBe(true)
  })

  it('forecast intervals are nested and centred on every forecast row; actuals exist for the first 6 months', () => {
    const t = generateDataset('forecast', 2, 36)
    const rows = t.rows.filter((r) => r[2] != null)
    expect(rows).toHaveLength(12)
    for (const r of rows) {
      const lo = { 0.5: r[3] as number, 0.8: r[5] as number, 0.95: r[7] as number }
      const hi = { 0.5: r[4] as number, 0.8: r[6] as number, 0.95: r[8] as number }
      expect(fanIssue({ center: r[2] as number, lo, hi })).toBeNull()
    }
    // uncertainty grows with the horizon
    const width = (r: (typeof rows)[number]) => (r[8] as number) - (r[7] as number)
    expect(width(rows[11])).toBeGreaterThan(width(rows[0]))
    expect(rows.filter((r) => r[1] != null)).toHaveLength(6)
    expect(t.rows.slice(0, 36).every((r) => r[1] != null && r[2] == null)).toBe(true)
    const b = bandsFromSigma(100, 5)
    expect(b.hi[0.95]).toBeGreaterThan(b.hi[0.5])
  })

  it('stage-flow data conserves the population at every stage and every interior node', () => {
    for (const n of [60, 300, 777]) {
      const t = generateDataset('stage-flow', 4, n)
      const rows = t.rows.map((r, row) => ({ fromStage: String(r[0]), toStage: String(r[1]), from: String(r[2]), to: String(r[3]), value: r[4] as number, row }))
      const a = buildAlluvial(rows, { width: 600, height: 300, nodeWidth: 12, nodePad: 8, order: 'data' })
      expect(a.stages).toEqual(['1학년', '2학년', '3학년'])
      expect(stageTotals(a)).toEqual([n, n, n])
      expect(a.imbalanced).toEqual([])
      expect(a.issues).toEqual([])
    }
  })

  it('network data forms a graph with three groups, valid edges and every node declared', () => {
    const t = generateDataset('network', 6, 18)
    const net = buildNetwork(t.rows.map((r, row) => ({ source: toLabel(r[0]), target: toLabel(r[1]), weight: toNumber(r[2]), group: toLabel(r[3]), row })))
    expect(net.nodes).toHaveLength(18)
    expect(new Set(net.nodes.map((n) => n.group))).toEqual(new Set(['A팀', 'B팀', 'C팀']))
    expect(net.selfLoops).toBe(0)
    expect(net.skipped).toBe(0)
    expect(net.links.length).toBeGreaterThan(18)
  })

  it('classifier datasets contain both classes and the stated positive rates', () => {
    for (const [id, lo, hi] of [['scores', 0.3, 0.5], ['scores-imbalanced', 0.02, 0.09]] as const) {
      const t = generateDataset(id, 3)
      const data: Scored[] = t.rows.map((r, row) => ({ score: r[0] as number, label: r[1] as 0 | 1, row }))
      expect(curveIssue(data)).toBeNull()
      expect(prevalence(data)).toBeGreaterThan(lo)
      expect(prevalence(data)).toBeLessThan(hi)
      expect(data.every((d) => d.score >= 0 && d.score <= 1 && (d.label === 0 || d.label === 1))).toBe(true)
    }
  })

  it('survey data is a complete cross-tab whose counts add up to the number of respondents', () => {
    const t = generateDataset('survey', 3, 600)
    expect(t.rows).toHaveLength(3 * 3 * 2)
    expect((numbers(t, '응답 수') as number[]).reduce((s, v) => s + v, 0)).toBe(600)
  })

  it('pyramid, defects, kpi and groups datasets have the advertised shape', () => {
    const p = generateDataset('pyramid')
    expect(p.rows).toHaveLength(18)
    expect((numbers(p, '여성') as number[]).slice(-1)[0]).toBeGreaterThan((numbers(p, '남성') as number[]).slice(-1)[0])
    const d = numbers(generateDataset('defects'), '건수') as number[]
    expect(d[0] / d.reduce((s, v) => s + v, 0)).toBeGreaterThan(0.25)
    const k = generateDataset('kpi')
    k.rows.forEach((r) => { expect(r[3]).toBeLessThan(r[4] as number); expect(r[4]).toBeLessThan(r[5] as number) })
    const g = generateDataset('big-groups', 1, 3000)
    expect(new Set(col(g, '그룹'))).toEqual(new Set(['A', 'B', 'C']))
    expect(generateDataset('pca-students', 2, 120).columns.filter((c) => c.type === 'number')).toHaveLength(6)
    const tr = generateDataset('trajectory', 1, 24)
    expect(col(tr, '연도')[23]).toBe(2023)
  })
})

describe('dates in CSV and tables', () => {
  it('recognises ISO date and date-time columns and keeps the text', () => {
    const r = parseCsv('날짜,시각,값\n2024-02-29,2024-03-01T09:30,3\n2024-03-01,2024-03-01T10:00,4\n')
    expect(r.table!.columns.map((c) => c.type)).toEqual(['date', 'date', 'number'])
    expect(r.table!.rows[0]).toEqual(['2024-02-29', '2024-03-01T09:30', 3])
    expect(r.ambiguous).toEqual([])
    expect(formatCsv(r.table!)).toContain('2024-02-29,2024-03-01T09:30,3')
  })

  it('keeps a column with an impossible date categorical', () => {
    const r = parseCsv('날짜,값\n2023-02-29,1\n2023-03-01,2\n')
    expect(r.table!.columns[0].type).toBe('category')
  })

  it('does not guess ambiguous day/month dates but reads them when a format is chosen', () => {
    const text = '날짜,값\n03/04/2024,1\n05/06/2024,2\n'
    const guess = parseCsv(text)
    expect(guess.table!.columns[0].type).toBe('category')
    expect(guess.ambiguous).toEqual(['날짜'])
    expect(guess.warnings.join(' ')).toMatch(/모호/)
    const us = parseCsv(text, 'mdy')
    expect(us.table!.columns[0].type).toBe('date')
    expect(us.table!.rows[0][0]).toBe('2024-03-04')
    const eu = parseCsv(text, 'dmy')
    expect(eu.table!.rows[0][0]).toBe('2024-04-03')
    // unambiguous (13 > 12) slash dates need a format too, but are not flagged as ambiguous
    expect(parseCsv('날짜,값\n13/04/2024,1\n', 'dmy').table!.rows[0][0]).toBe('2024-04-13')
  })

  it('normalises typed dates and rejects non-dates', () => {
    expect(normalizeDate('2024.3.5')).toBe('2024-03-05')
    expect(normalizeDate('2024-03-05')).toBe('2024-03-05')
    expect(normalizeDate('2024-03-05 08:15')).toBe('2024-03-05T08:15')
    expect(normalizeDate('2023-02-29')).toBeNull()
    expect(normalizeDate('내일')).toBeNull()
    expect(normalizeDate('12/25/2024', 'mdy')).toBe('2024-12-25')
    expect(normalizeDate('25/12/2024', 'mdy')).toBeNull()
  })

  it('infers numbers before dates and mixed columns stay categorical', () => {
    const { columns } = inferColumns(['a', 'b', 'c'], [['2024', '2024-01-01', '2024-01-01'], ['2025', '2024-01-02', 'x']])
    expect(columns.map((c) => c.type)).toEqual(['number', 'date', 'category'])
  })

  it('continues a date column when a row is added (monthly data stays monthly)', () => {
    const t: DataTable = { columns: [{ name: 'd', type: 'date' }, { name: 'v', type: 'number' }], rows: [['2024-01-31', 1], ['2024-02-29', 2]] }
    expect(templateRow(t).d).toBe('2024-03-29')
    const daily: DataTable = { columns: t.columns, rows: [['2024-02-27', 1], ['2024-02-28', 2]] }
    expect(templateRow(daily).d).toBe('2024-02-29')
    expect(templateRow({ columns: t.columns, rows: [] }).d).toBe('2024-01-01')
  })

  it('counts invalid date cells but not empty ones', () => {
    const t: DataTable = { columns: [{ name: 'd', type: 'date' }], rows: [['2024-01-01'], ['2023-02-29'], [null], ['abc']] }
    expect(invalidDateCells(t)).toBe(2)
  })
})

describe('JSON import and export', () => {
  const table: DataTable = { columns: [{ name: '날짜', type: 'date' }, { name: '값', type: 'number' }, { name: '분류', type: 'category' }], rows: [['2024-03-01', 1.5, 'a'], ['2024-03-02', null, 'b']] }

  it('round-trips a table exactly', () => {
    const back = parseJson(formatJson(table))
    expect(back.error).toBeUndefined()
    expect(back.table).toEqual(table)
  })

  it('reads an array of records and infers the types', () => {
    const r = parseJson('[{"day":"2024-01-05","n":3,"g":"x"},{"day":"2024-01-06","n":4,"g":"y"}]')
    expect(r.table!.columns).toEqual([{ name: 'day', type: 'date' }, { name: 'n', type: 'number' }, { name: 'g', type: 'category' }])
    expect(r.table!.rows[1]).toEqual(['2024-01-06', 4, 'y'])
  })

  it('reports malformed input instead of throwing', () => {
    expect(parseJson('{oops').error).toMatch(/JSON/)
    expect(parseJson('{"columns":[{"name":"a","type":"weird"}],"rows":[]}').error).toMatch(/열 정의/)
    expect(parseJson('{"columns":[{"name":"a","type":"number"},{"name":"a","type":"number"}],"rows":[[1,2]]}').error).toMatch(/중복/)
    expect(parseJson('{"columns":[{"name":"a","type":"number"}],"rows":[]}').error).toMatch(/행/)
    expect(parseJson('42').error).toBeTruthy()
    const ragged = parseJson('{"columns":[{"name":"a","type":"number"},{"name":"b","type":"number"}],"rows":[[1],[2,3,4]]}')
    expect(ragged.table!.rows).toEqual([[1, null], [2, 3]])
    expect(ragged.warnings.join(' ')).toMatch(/길이/)
  })
})
