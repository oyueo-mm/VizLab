import { columnIndex, toLabel, toNumber, type DataTable } from '../data/table'

export interface TreeNode { name: string; value?: number; children?: TreeNode[] }

/** Builds a nested tree from level columns (outer → inner), summing positive values of identical paths. */
export function buildTree(table: DataTable, levels: string[], valueCol: string | null): { tree: TreeNode; skipped: number } {
  const li = levels.map((l) => columnIndex(table, l))
  const vi = columnIndex(table, valueCol)
  const root: TreeNode = { name: '전체', children: [] }
  let skipped = 0
  for (const r of table.rows) {
    const v = vi >= 0 ? toNumber(r[vi]) : 1
    if (v == null || v <= 0) { skipped++; continue }
    let node = root
    li.forEach((ci, depth) => {
      const name = toLabel(r[ci]) || '(빈 값)'
      node.children ??= []
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        child = depth === li.length - 1 ? { name, value: 0 } : { name, children: [] }
        node.children.push(child)
      }
      node = child
    })
    node.value = (node.value ?? 0) + v
  }
  return { tree: root, skipped }
}

/** Row indices whose level path starts with `path` (an empty path matches every row). */
export function rowsUnder(table: DataTable, levels: string[], path: readonly string[]) {
  const li = levels.map((l) => columnIndex(table, l))
  const out: number[] = []
  table.rows.forEach((r, i) => {
    if (path.every((name, d) => (toLabel(r[li[d]]) || '(빈 값)') === name)) out.push(i)
  })
  return out
}
