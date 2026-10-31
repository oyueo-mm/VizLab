import { describe, expect, it } from 'vitest'
import { mean, standardDeviation } from '../stats/descriptive'
import { formatCsv, parseCsv } from './csv'
import { datasets, generateDataset } from './datasets'
import { appendRow, invalidNumericCells, numbers, removeRows, setCell, templateRow, toNumber, toTime, type DataTable } from './table'
import { createRng } from '../lib/random'

describe('seeded random generator', () => {
  it('is reproducible and seed dependent', () => {
    const a = createRng(42)
    const b = createRng(42)
    const c = createRng(43)
    const sa = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(sa)
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(sa)
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('produces standard normal variates', () => {
    const r = createRng(9)
    const v = Array.from({ length: 20000 }, () => r.normal())
    expect(mean(v)).toBeCloseTo(0, 1)
    expect(standardDeviation(v)).toBeCloseTo(1, 1)
  })
})

describe('dataset library', () => {
  it('generates every dataset with consistent typed columns', () => {
    for (const d of datasets) {
      const t = generateDataset(d.id)
      expect(t.rows.length, d.id).toBeGreaterThan(0)
      for (const row of t.rows) {
        expect(row.length).toBe(t.columns.length)
        row.forEach((cell, i) => {
          // Sparse on purpose: history rows have no forecast; a network row without a target only declares a node.
          if ((d.id === 'forecast' || d.id === 'network') && cell === null) return
          if (t.columns[i].type === 'number') expect(typeof cell === 'number' && Number.isFinite(cell), `${d.id}.${t.columns[i].name}`).toBe(true)
          else if (t.columns[i].type === 'date') expect(toTime(cell), `${d.id}.${t.columns[i].name}`).not.toBeNull()
          else expect(typeof cell).toBe('string')
        })
      }
    }
  })

  it('reproduces the same sample for the same seed and size', () => {
    for (const d of datasets) expect(generateDataset(d.id, 5, 60)).toEqual(generateDataset(d.id, 5, 60))
    expect(generateDataset('normal', 1)).not.toEqual(generateDataset('normal', 2))
  })

  it('respects and clamps the sample size', () => {
    expect(generateDataset('normal', 1, 37).rows.length).toBe(37)
    expect(generateDataset('normal', 1, 1).rows.length).toBe(10)
    expect(generateDataset('timeseries', 1, 12).rows.length).toBe(36) // 12 months × 3 channels
  })

  it('has the advertised statistical shape', () => {
    const v = numbers(generateDataset('normal', 3, 2000), '값') as number[]
    expect(mean(v)).toBeGreaterThan(49)
    expect(mean(v)).toBeLessThan(51)
    expect(standardDeviation(v)).toBeGreaterThan(9.3)
    expect(standardDeviation(v)).toBeLessThan(10.7)
    const u = numbers(generateDataset('uniform', 3, 2000), '값') as number[]
    expect(Math.min(...u)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...u)).toBeLessThan(100)
  })
})

describe('table operations', () => {
  const t: DataTable = { columns: [{ name: 'a', type: 'category' }, { name: 'b', type: 'number' }], rows: [['x', 1], ['y', 2]] }

  it('parses numeric cells leniently', () => {
    expect(toNumber(3)).toBe(3)
    expect(toNumber('1,234.5')).toBe(1234.5)
    expect(toNumber('abc')).toBeNull()
    expect(toNumber('')).toBeNull()
    expect(toNumber(Number.NaN)).toBeNull()
  })

  it('edits immutably', () => {
    const next = setCell(t, 1, 'b', 9)
    expect(next.rows[1][1]).toBe(9)
    expect(t.rows[1][1]).toBe(2)
    expect(removeRows(t, [0]).rows).toEqual([['y', 2]])
    expect(appendRow(t, { a: 'z' }).rows[2]).toEqual(['z', null])
  })

  it('templates new rows from the last category and the column mean', () => {
    expect(templateRow(t)).toEqual({ a: 'y', b: 1.5 })
  })

  it('counts invalid numeric cells', () => {
    expect(invalidNumericCells(setCell(t, 0, 'b', 'oops'))).toBe(1)
  })
})

describe('CSV', () => {
  it('parses quotes, BOM, CRLF and infers column types', () => {
    const res = parseCsv(String.fromCharCode(0xfeff) + '이름,값,메모\r\n"사과, 빨강",1.5,"말 ""인용"""\r\n바나나,2,\r\n')
    expect(res.error).toBeUndefined()
    expect(res.table!.columns).toEqual([{ name: '이름', type: 'category' }, { name: '값', type: 'number' }, { name: '메모', type: 'category' }])
    expect(res.table!.rows).toEqual([['사과, 빨강', 1.5, '말 "인용"'], ['바나나', 2, null]])
  })

  it('treats a column with any non-number as categorical', () => {
    const res = parseCsv('a,b\n1,x\n2,3')
    expect(res.table!.columns.map((c) => c.type)).toEqual(['number', 'category'])
  })

  it('reports problems instead of throwing', () => {
    expect(parseCsv('').error).toBeTruthy()
    expect(parseCsv('only,header').error).toBeTruthy()
    const ragged = parseCsv('a,b\n1\n2,3,4')
    expect(ragged.table!.rows).toEqual([[1, null], [2, 3]])
    expect(ragged.warnings.length).toBe(1)
    const dup = parseCsv('x,x\n1,2')
    expect(dup.table!.columns.map((c) => c.name)).toEqual(['x', 'x_2'])
  })

  it('round-trips through format and parse', () => {
    const t = generateDataset('pos-corr', 2, 20)
    expect(parseCsv(formatCsv(t)).table).toEqual(t)
  })
})
