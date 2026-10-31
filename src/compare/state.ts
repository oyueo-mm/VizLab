import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SEED, datasetById, generateDataset, type DatasetId } from '../data/datasets'
import type { DataTable } from '../data/table'
import { readStored, writeStored } from '../hooks/storage'
import type { Mapping } from '../viz/types'
import { MAX_PANES, presetById, presets } from './presets'

export interface PaneState {
  id: string
  viz: string
  /** Column choices the user made for this chart; unset roles are filled from the shared table. */
  mapping: Mapping
  /** Settings changed in this chart only — other charts keep their own. */
  params: Record<string, unknown>
  settings: boolean
}

export interface CompareState {
  presetId: string | null
  datasetId: DatasetId | 'custom'
  seed: number
  n: number
  table: DataTable
  edited: boolean
  customName?: string
  /** Mark the same observations in every chart that supports it. */
  link: boolean
  panes: PaneState[]
}

const KEY = 'compare:v1'
const MAX_STORED_CELLS = 60000
let paneCounter = 0
const newPane = (viz: string): PaneState => ({ id: `p${Date.now().toString(36)}${++paneCounter}`, viz, mapping: {}, params: {}, settings: false })

export function stateForPreset(presetId: string): CompareState {
  const preset = presetById.get(presetId) ?? presets[0]
  const n = preset.n ?? datasetById.get(preset.datasetId)?.size?.default ?? 0
  return { presetId: preset.id, datasetId: preset.datasetId, seed: DEFAULT_SEED, n, table: generateDataset(preset.datasetId, DEFAULT_SEED, n), edited: false, link: true, panes: preset.charts.map(newPane) }
}

interface Stored extends Omit<CompareState, 'table'> { table?: DataTable }

function restore(): CompareState {
  const fallback = stateForPreset(presets[0].id)
  const saved = readStored<Stored | null>(KEY, null)
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.panes) || !saved.panes.length) return fallback
  try {
    let table = saved.table
    if (!table) {
      if (saved.datasetId === 'custom' || !datasetById.has(saved.datasetId)) return fallback
      table = generateDataset(saved.datasetId, saved.seed, saved.n)
    }
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) return fallback
    return {
      ...saved, table, link: saved.link !== false,
      panes: saved.panes.slice(0, MAX_PANES).map((p) => ({ id: p.id || newPane(p.viz).id, viz: p.viz, mapping: p.mapping ?? {}, params: p.params ?? {}, settings: !!p.settings })),
    }
  } catch {
    return fallback
  }
}

function persist(s: CompareState) {
  const keep = s.edited || s.datasetId === 'custom'
  writeStored(KEY, { ...s, table: keep && s.table.rows.length * s.table.columns.length <= MAX_STORED_CELLS ? s.table : undefined })
}

/** State of the comparison lab: one shared table and a few charts that each keep their own mapping and settings. */
export function useCompareState(initialPreset?: string) {
  const [state, setState] = useState<CompareState>(() => (initialPreset && presetById.has(initialPreset) ? stateForPreset(initialPreset) : restore()))
  useEffect(() => {
    const t = window.setTimeout(() => persist(state), 250)
    return () => window.clearTimeout(t)
  }, [state])
  const ref = useRef(state)
  ref.current = state

  const actions = useMemo(() => {
    const set = (fn: (s: CompareState) => CompareState) => setState((s) => fn(s))
    const patchPane = (i: number, fn: (p: PaneState) => PaneState) => set((s) => ({ ...s, panes: s.panes.map((p, k) => (k === i ? fn(p) : p)) }))
    return {
      loadPreset: (id: string) => setState(stateForPreset(id)),
      loadDataset: (datasetId: DatasetId, seed?: number, n?: number) => set((s) => {
        const size = n ?? (datasetId === s.datasetId ? s.n : datasetById.get(datasetId)?.size?.default ?? 0)
        const sd = seed ?? s.seed
        return { ...s, presetId: s.presetId, datasetId, seed: sd, n: size, table: generateDataset(datasetId, sd, size), edited: false, customName: undefined }
      }),
      loadCustom: (table: DataTable, name: string) => set((s) => ({ ...s, datasetId: 'custom', table, edited: true, customName: name })),
      setTable: (table: DataTable) => set((s) => ({ ...s, table, edited: true })),
      restoreData: () => set((s) => (s.datasetId === 'custom' ? s : { ...s, table: generateDataset(s.datasetId, s.seed, s.n), edited: false })),
      reset: () => setState(stateForPreset(ref.current.presetId ?? presets[0].id)),
      setLink: (link: boolean) => set((s) => ({ ...s, link })),
      addPane: (viz: string) => set((s) => (s.panes.length >= MAX_PANES ? s : { ...s, presetId: null, panes: [...s.panes, newPane(viz)] })),
      removePane: (i: number) => set((s) => (s.panes.length <= 1 ? s : { ...s, presetId: null, panes: s.panes.filter((_, k) => k !== i) })),
      setViz: (i: number, viz: string) => patchPane(i, (p) => ({ ...p, viz, mapping: {}, params: {} })),
      setParams: (i: number, patch: Record<string, unknown>) => patchPane(i, (p) => ({ ...p, params: { ...p.params, ...patch } })),
      setMapping: (i: number, mapping: Mapping) => patchPane(i, (p) => ({ ...p, mapping })),
      toggleSettings: (i: number) => patchPane(i, (p) => ({ ...p, settings: !p.settings })),
    }
  }, [])
  return { state, actions }
}

export type CompareActions = ReturnType<typeof useCompareState>['actions']
