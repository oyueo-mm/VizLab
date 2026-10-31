import { columnIndex, toLabel, toNumber, type DataTable } from '../data/table'

export interface RelationMatrix {
  labels: string[]
  /** matrix[i][j]: flow from group i to group j. */
  matrix: number[][]
  /** Numeric columns whose name matches no row label (ignored). */
  unmatchedColumns: string[]
  /** Row labels that have no numeric column of the same name (their incoming values are 0). */
  unmatchedRows: string[]
}

/**
 * Reads a square relation table: each row is a group (its label in `fromCol`), and the numeric column
 * named like another group holds the value of the relation row → column. Duplicate row labels are summed;
 * negative or missing cells count as 0.
 */
export function relationMatrix(table: DataTable, fromCol: string | null, toCols: readonly string[]): RelationMatrix {
  const fi = columnIndex(table, fromCol)
  const labels: string[] = []
  const rows = new Map<string, number[]>()
  table.rows.forEach((r, i) => {
    const l = toLabel(r[fi])
    if (!l) return
    if (!rows.has(l)) { rows.set(l, []); labels.push(l) }
    rows.get(l)!.push(i)
  })
  const matrix = labels.map(() => labels.map(() => 0))
  const colIdx = new Map(toCols.map((c) => [c, columnIndex(table, c)]))
  const unmatchedColumns = toCols.filter((c) => !labels.includes(c))
  const unmatchedRows = labels.filter((l) => !toCols.includes(l))
  labels.forEach((from, i) => {
    labels.forEach((to, j) => {
      const ci = colIdx.get(to)
      if (ci == null || ci < 0) return
      for (const r of rows.get(from)!) matrix[i][j] += Math.max(0, toNumber(table.rows[r][ci]) ?? 0)
    })
  })
  return { labels, matrix, unmatchedColumns, unmatchedRows }
}

/** Reorders a relation matrix by a list of labels (missing ones keep their relative order at the end). */
export function reorderMatrix(rel: Pick<RelationMatrix, 'labels' | 'matrix'>, order: readonly string[]) {
  const rank = (l: string) => { const k = order.indexOf(l); return k < 0 ? order.length : k }
  const idx = rel.labels.map((_, i) => i).sort((a, b) => rank(rel.labels[a]) - rank(rel.labels[b]) || a - b)
  return { labels: idx.map((i) => rel.labels[i]), matrix: idx.map((i) => idx.map((j) => rel.matrix[i][j])) }
}
