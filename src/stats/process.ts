import * as d3 from 'd3'
import { DAY_MS } from './datetime'

// ─── funnel chart (conversion) ──────────────────────────────────────────────

export interface Stage { name: string; value: number; row: number }

export interface StageMetric {
  name: string
  value: number
  /** Share of the first stage that is left (value / first value). */
  ofFirst: number
  /** Share of the previous stage that continued (value / previous value); null for the first stage. */
  conversion: number | null
  /** Share lost since the previous stage (1 − conversion), and the absolute amount lost. */
  dropRate: number | null
  dropped: number | null
  /** True when more arrived than the previous stage had: new entries joined mid-process, so it is not a pure conversion funnel. */
  inflow: boolean
  row: number
}

/** Stage-to-stage conversion and drop-off. Stages whose value exceeds the previous one are flagged instead of clamped or hidden. */
export function funnelMetrics(stages: readonly Stage[]): StageMetric[] {
  const first = stages[0]?.value ?? 0
  return stages.map((s, i) => {
    const prev = i ? stages[i - 1].value : null
    const conversion = prev != null && prev > 0 ? s.value / prev : null
    return { name: s.name, value: s.value, ofFirst: first > 0 ? s.value / first : 0, conversion, dropRate: conversion == null ? null : 1 - conversion, dropped: prev == null ? null : prev - s.value, inflow: prev != null && s.value > prev, row: s.row }
  })
}

// ─── Gantt chart ────────────────────────────────────────────────────────────

export interface Task { name: string; start: number; end: number; group: string; progress: number | null; deps: string[]; row: number }

/** Task length in whole days, counting both the start and the end date (a task that starts and ends on the same day lasts 1 day). */
export const durationDays = (t: Pick<Task, 'start' | 'end'>) => Math.round((t.end - t.start) / DAY_MS) + 1

export interface TaskIssue { row: number; text: string }

/**
 * Schedule problems: end before start, a predecessor that does not exist, a task that depends on itself, a dependency cycle, and a task
 * that starts before a predecessor ends. Nothing is rewritten automatically — the chart shows the problem where it is.
 */
export function validateTasks(tasks: readonly Task[]): TaskIssue[] {
  const issues: TaskIssue[] = []
  const byName = new Map(tasks.map((t) => [t.name, t]))
  for (const t of tasks) {
    if (t.end < t.start) issues.push({ row: t.row, text: `‘${t.name}’의 종료일이 시작일보다 빠릅니다.` })
    for (const d of t.deps) {
      const p = byName.get(d)
      if (d === t.name) issues.push({ row: t.row, text: `‘${t.name}’이(가) 자기 자신에 의존합니다.` })
      else if (!p) issues.push({ row: t.row, text: `‘${t.name}’의 선행 작업 ‘${d}’이(가) 없습니다.` })
      else if (t.start <= p.end) issues.push({ row: t.row, text: `‘${t.name}’이(가) 선행 작업 ‘${d}’이(가) 끝나기 전에 시작합니다.` })
    }
  }
  const cycle = findCycle(tasks)
  if (cycle) issues.push({ row: tasks.find((t) => t.name === cycle[0])?.row ?? 0, text: `의존 관계에 순환이 있습니다: ${cycle.join(' → ')}` })
  return issues
}

/** A dependency cycle as a list of task names, or null. */
export function findCycle(tasks: readonly Pick<Task, 'name' | 'deps'>[]): string[] | null {
  const deps = new Map(tasks.map((t) => [t.name, t.deps.filter((d) => d !== t.name)]))
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 1)
    stack.push(n)
    for (const d of deps.get(n) ?? []) {
      if (!deps.has(d)) continue
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d]
      if (!state.get(d)) { const c = visit(d); if (c) return c }
    }
    stack.pop()
    state.set(n, 2)
    return null
  }
  for (const t of tasks) if (!state.get(t.name)) { const c = visit(t.name); if (c) return c }
  return null
}

/** Moves a task by whole days, keeping its length. */
export const shiftTask = (t: Pick<Task, 'start' | 'end'>, days: number) => ({ start: t.start + days * DAY_MS, end: t.end + days * DAY_MS })

/** Changes one edge by whole days; a task never becomes shorter than one day. */
export function resizeTask(t: Pick<Task, 'start' | 'end'>, edge: 'start' | 'end', days: number) {
  if (edge === 'start') return { start: Math.min(t.start + days * DAY_MS, t.end), end: t.end }
  return { start: t.start, end: Math.max(t.end + days * DAY_MS, t.start) }
}

// ─── Marimekko ──────────────────────────────────────────────────────────────

export interface MekkoColumn { name: string; total: number; segments: { name: string; value: number; share: number; row: number[] }[] }

/**
 * Marimekko columns: each category's width is proportional to its total and each segment's height to its share inside the category, so a
 * rectangle's area is proportional to value / grand total. Negative values are ignored.
 */
export function marimekko(rows: readonly { category: string; segment: string; value: number; row: number }[], categoryOrder?: readonly string[], segmentOrder?: readonly string[]) {
  const cats = categoryOrder ? [...categoryOrder] : []
  const segs = segmentOrder ? [...segmentOrder] : []
  const m = new Map<string, Map<string, { value: number; rows: number[] }>>()
  for (const r of rows) {
    if (!(r.value >= 0) || !r.category || !r.segment) continue
    if (!cats.includes(r.category)) cats.push(r.category)
    if (!segs.includes(r.segment)) segs.push(r.segment)
    const col = m.get(r.category) ?? new Map()
    const cell = col.get(r.segment) ?? { value: 0, rows: [] }
    cell.value += r.value
    cell.rows.push(r.row)
    col.set(r.segment, cell)
    m.set(r.category, col)
  }
  const columns: MekkoColumn[] = cats.filter((c) => m.has(c)).map((c) => {
    const col = m.get(c)!
    const total = d3.sum([...col.values()], (x) => x.value)
    return { name: c, total, segments: segs.filter((s) => col.has(s)).map((s) => ({ name: s, value: col.get(s)!.value, share: total ? col.get(s)!.value / total : 0, row: col.get(s)!.rows })) }
  })
  return { columns, segments: segs, grand: d3.sum(columns, (c) => c.total) }
}

// ─── flame graph ────────────────────────────────────────────────────────────

export interface FlameNode { name: string; self: number; total: number; children: FlameNode[]; path: string[]; rows: number[] }

export interface FlameRow { stack: string; value: number; row: number }

/**
 * Builds the call tree from "folded stacks" — one row per distinct call stack, "main;parse;lex" with its sample count (the format of
 * Brendan Gregg's flamegraph.pl). Stacks that share a prefix share nodes. `total` is the cost of the function plus everything it calls.
 */
export function buildFlame(rows: readonly FlameRow[], sep = ';'): FlameNode {
  const root: FlameNode = { name: '전체', self: 0, total: 0, children: [], path: [], rows: [] }
  for (const r of rows) {
    if (!(r.value > 0) || !r.stack.trim()) continue
    let node = root
    root.total += r.value
    for (const raw of r.stack.split(sep)) {
      const name = raw.trim()
      if (!name) continue
      let child = node.children.find((c) => c.name === name)
      if (!child) { child = { name, self: 0, total: 0, children: [], path: [...node.path, name], rows: [] }; node.children.push(child) }
      child.total += r.value
      child.rows.push(r.row)
      node = child
    }
    node.self += r.value
    if (node === root) root.self += r.value
  }
  return root
}

export interface FlameBlock { node: FlameNode; depth: number; x0: number; x1: number }

/**
 * Flame layout of the subtree at `focus`: width ∝ total cost, depth = call depth, siblings in alphabetical order. The horizontal order
 * is NOT time: a flame graph merges every call of the same stack, so left-to-right only separates different call paths.
 */
export function flameLayout(root: FlameNode, focus: readonly string[] = [], maxDepth = 64): { blocks: FlameBlock[]; top: FlameNode } {
  let top = root
  for (const name of focus) { const c = top.children.find((x) => x.name === name); if (!c) break; top = c }
  const blocks: FlameBlock[] = []
  const walk = (n: FlameNode, depth: number, x0: number) => {
    const w = top.total > 0 ? n.total / top.total : 0
    blocks.push({ node: n, depth, x0, x1: x0 + w })
    if (depth >= maxDepth) return
    let x = x0
    for (const c of [...n.children].sort((a, b) => a.name.localeCompare(b.name))) { walk(c, depth + 1, x); x += top.total > 0 ? c.total / top.total : 0 }
  }
  walk(top, 0, 0)
  return { blocks, top }
}

/** Blocks whose function name matches the query (case-insensitive substring). */
export const flameMatches = (blocks: readonly FlameBlock[], query: string) => {
  const q = query.trim().toLowerCase()
  return new Set(q ? blocks.filter((b) => b.node.name.toLowerCase().includes(q)).map((b) => b.node.path.join(';')) : [])
}
