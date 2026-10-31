import * as d3 from 'd3'

export type StackOrderName = 'none' | 'ascending' | 'descending' | 'insideOut' | 'reverse'
export type StackOffsetName = 'none' | 'expand' | 'wiggle' | 'silhouette'

export const stackOrders: Record<StackOrderName, typeof d3.stackOrderNone> = {
  none: d3.stackOrderNone, ascending: d3.stackOrderAscending, descending: d3.stackOrderDescending, insideOut: d3.stackOrderInsideOut, reverse: d3.stackOrderReverse,
}
export const stackOffsets: Record<StackOffsetName, typeof d3.stackOffsetNone> = {
  none: d3.stackOffsetNone, expand: d3.stackOffsetExpand, wiggle: d3.stackOffsetWiggle, silhouette: d3.stackOffsetSilhouette,
}

/** d3.stack over row objects keyed by series name (negative values are clamped to 0). */
export function stackRows(keys: readonly string[], rows: readonly Record<string, number>[], offset: StackOffsetName = 'none', order: StackOrderName = 'none') {
  return d3.stack<Record<string, number>>().keys(keys).value((d, k) => Math.max(0, d[k] ?? 0)).order(stackOrders[order]).offset(stackOffsets[offset])(rows as Record<string, number>[])
}

/** Stacks a category × group cross-tab: one series per group, each segment [y0, y1]. */
export function stackCrossTab(cats: string[], groups: string[], value: (c: string, g: string) => number, mode: 'stack' | 'normalize', order: StackOrderName) {
  const rows = cats.map((c) => Object.fromEntries(groups.map((g) => [g, Math.max(0, value(c, g))])))
  return stackRows(groups, rows, mode === 'normalize' ? 'expand' : 'none', order)
}

export interface XYSeries { key: string; pts: readonly { x: number; y: number }[] }

/** Aligns series on the union of x values; a series without a value at some x contributes 0 there. */
export function alignSeries(series: readonly XYSeries[]) {
  const xs = [...new Set(series.flatMap((s) => s.pts.map((p) => p.x)))].sort((a, b) => a - b)
  const lookup = series.map((s) => new Map(s.pts.map((p) => [p.x, p.y])))
  const rows = xs.map((xv) => Object.fromEntries(series.map((s, i) => [s.key, Math.max(0, lookup[i].get(xv) ?? 0)])))
  return { xs, rows }
}

export type AreaMode = 'overlap' | 'stack' | 'normalize' | 'stream'

/** Aligns series on shared x values and stacks them with the offset that matches the area mode. */
export function stackSeries(series: readonly XYSeries[], mode: AreaMode, order?: StackOrderName) {
  const { xs, rows } = alignSeries(series)
  const offset: StackOffsetName = mode === 'normalize' ? 'expand' : mode === 'stream' ? 'wiggle' : 'none'
  return { xs, layers: stackRows(series.map((s) => s.key), rows, offset, order ?? (mode === 'stream' ? 'insideOut' : 'none')) }
}
