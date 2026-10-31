import type { ComponentType } from 'react'
import type { DatasetId } from '../data/datasets'
import type { ColumnType, DataTable } from '../data/table'

export type CategoryId = 'distribution' | 'relationship' | 'comparison' | 'timeseries' | 'composition' | 'multivariate' | 'hierarchy' | 'uncertainty'

/** A visual channel the chart needs (x, y, color, …) and what kind of column can fill it. */
export interface RoleSpec {
  key: string
  label: string
  type: ColumnType
  required?: boolean
  /** Multi-column role (e.g. pair-plot variables). Value is an ordered list of column names. */
  multiple?: { min: number; max?: number }
  /** Fill optional roles automatically when a suitable column exists. */
  auto?: boolean
}

export type Mapping = Record<string, string | string[] | null>

/** Catalog entry: everything the catalog, search and home page need without loading the chart. */
export interface VizMeta {
  id: string
  name: string
  nameEn: string
  category: CategoryId
  /** Extra categories the chart also appears under. */
  alsoIn?: CategoryId[]
  keywords: string[]
  /** One-sentence description shown in the lab header. */
  summary: string
  related: string[]
}

export interface ChartProps<P> {
  table: DataTable
  mapping: Mapping
  params: P
  setParams: (patch: Partial<P>) => void
  width: number
  height: number
  /** Thumbnail mode: no interaction, minimal axes. */
  compact?: boolean
  /** Present only when direct manipulation is allowed. */
  /** `transient` marks intermediate drag updates that should not create separate undo steps. */
  onTableChange?: (next: DataTable, transient?: boolean) => void
}

export interface ControlsProps<P> {
  params: P
  setParams: (patch: Partial<P>) => void
  table: DataTable
  mapping: Mapping
  /** Structural edits from the panel (add a series, a node, a time point…); undoable like table edits. */
  setTable?: (next: DataTable) => void
}

export interface VizModule<P extends object = any> {
  roles: RoleSpec[]
  /** Datasets offered first in the picker; the first one is the default. */
  datasets: DatasetId[]
  defaultParams: P
  Chart: ComponentType<ChartProps<P>>
  Controls?: ComponentType<ControlsProps<P>>
  /** Short instruction for the direct-manipulation gestures available on the chart. */
  hint?: string
}
