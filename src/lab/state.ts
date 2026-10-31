import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SEED, datasetById, generateDataset, type DatasetId } from '../data/datasets'
import type { DataTable } from '../data/table'
import { readStored, writeStored } from '../hooks/storage'
import { autoMapping } from '../viz/mapping'
import type { Mapping, VizModule } from '../viz/types'

export interface LabState {
  /** 'custom' after a CSV import. */
  datasetId: DatasetId | 'custom'
  seed: number
  n: number
  table: DataTable
  /** True once the table differs from what the dataset generator would produce. */
  edited: boolean
  customName?: string
  mapping: Mapping
  params: Record<string, unknown>
}

const VERSION = 1
const storageKey = (id: string) => `lab:${id}:v${VERSION}`
/** Tables larger than this are regenerated from seed instead of being stored. */
const MAX_STORED_CELLS = 60000

export function datasetSize(datasetId: DatasetId) {
  return datasetById.get(datasetId)?.size?.default ?? 0
}

export function initialLabState(_id: string, mod: VizModule): LabState {
  const datasetId = mod.datasets[0]
  const n = datasetSize(datasetId)
  const table = generateDataset(datasetId, DEFAULT_SEED, n)
  return { datasetId, seed: DEFAULT_SEED, n, table, edited: false, mapping: autoMapping(mod.roles, table), params: { ...mod.defaultParams } }
}

interface Stored extends Omit<LabState, 'table'> { table?: DataTable }

function restore(id: string, mod: VizModule): LabState {
  const fallback = initialLabState(id, mod)
  const saved = readStored<Stored | null>(storageKey(id), null)
  if (!saved || typeof saved !== 'object') return fallback
  try {
    let table = saved.table
    if (!table) {
      if (saved.datasetId === 'custom' || !datasetById.has(saved.datasetId)) return fallback
      table = generateDataset(saved.datasetId, saved.seed, saved.n)
    }
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) return fallback
    return {
      ...saved,
      table,
      mapping: autoMapping(mod.roles, table, saved.mapping),
      params: { ...mod.defaultParams, ...(saved.params ?? {}) },
    }
  } catch {
    return fallback
  }
}

function persist(id: string, s: LabState) {
  const cells = s.table.rows.length * s.table.columns.length
  const keepTable = s.edited || s.datasetId === 'custom'
  writeStored(storageKey(id), { ...s, table: keepTable && cells <= MAX_STORED_CELLS ? s.table : undefined })
}

const HISTORY = 60

/** Lab state with persistence and an undo/redo stack for table edits. */
export function useLabState(id: string, mod: VizModule) {
  const [state, setState] = useState<LabState>(() => restore(id, mod))
  // Source of truth for event handlers, updated synchronously so rapid consecutive edits compose.
  const current = useRef(state)
  const undoStack = useRef<DataTable[]>([])
  const redoStack = useRef<DataTable[]>([])
  const inTransient = useRef(false)
  const [history, setHistory] = useState({ undo: 0, redo: 0 })

  useEffect(() => {
    const t = window.setTimeout(() => persist(id, state), 250)
    return () => window.clearTimeout(t)
  }, [id, state])

  const actions = useMemo(() => {
    const commit = (next: LabState) => {
      current.current = next
      setState(next)
    }
    const syncHistory = () => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length })
    const pushUndo = (table: DataTable) => {
      undoStack.current.push(table)
      if (undoStack.current.length > HISTORY) undoStack.current.shift()
      redoStack.current = []
      syncHistory()
    }
    const withTable = (s: LabState, table: DataTable, edited = true): LabState => ({ ...s, table, edited, mapping: autoMapping(mod.roles, table, s.mapping) })
    return {
      setTable: (next: DataTable, transient = false) => {
        const s = current.current
        if (transient) {
          if (!inTransient.current) { pushUndo(s.table); inTransient.current = true }
        } else if (inTransient.current) inTransient.current = false
        else if (next !== s.table) pushUndo(s.table)
        if (next !== s.table) commit(withTable(s, next))
      },
      undo: () => {
        const prev = undoStack.current.pop()
        if (!prev) return
        redoStack.current.push(current.current.table)
        commit(withTable(current.current, prev))
        syncHistory()
      },
      redo: () => {
        const next = redoStack.current.pop()
        if (!next) return
        undoStack.current.push(current.current.table)
        commit(withTable(current.current, next))
        syncHistory()
      },
      setParams: (patch: Record<string, unknown>) => commit({ ...current.current, params: { ...current.current.params, ...patch } }),
      setMapping: (mapping: Mapping) => commit({ ...current.current, mapping }),
      /** Switch dataset or resample: regenerates the table (undoable). */
      loadDataset: (datasetId: DatasetId, seed?: number, n?: number) => {
        const s = current.current
        const size = n ?? (datasetId === s.datasetId ? s.n : datasetSize(datasetId))
        const sd = seed ?? s.seed
        const table = generateDataset(datasetId, sd, size)
        pushUndo(s.table)
        commit({ ...s, datasetId, seed: sd, n: size, table, edited: false, customName: undefined, mapping: autoMapping(mod.roles, table, datasetId === s.datasetId ? s.mapping : undefined) })
      },
      loadCustom: (table: DataTable, name: string) => {
        const s = current.current
        pushUndo(s.table)
        commit({ ...s, datasetId: 'custom', table, edited: true, customName: name, mapping: autoMapping(mod.roles, table) })
      },
      /** Restore the current dataset's generated values (keeps chart settings). */
      restoreData: () => {
        const s = current.current
        if (s.datasetId === 'custom') return
        pushUndo(s.table)
        commit(withTable(s, generateDataset(s.datasetId, s.seed, s.n), false))
      },
      /** Everything back to the chart's defaults. */
      reset: () => {
        pushUndo(current.current.table)
        commit(initialLabState(id, mod))
      },
    }
  }, [id, mod])

  return { state, mod, actions, canUndo: history.undo > 0, canRedo: history.redo > 0 }
}

export type LabActions = ReturnType<typeof useLabState>['actions']
