import type { ComponentType } from 'react'
import type { DatasetId } from '../data/datasets'
import type { ColumnType, DataTable } from '../data/table'

/** Kinds of data a chart can show, used by the catalog's data-type filter (independent of the category). */
export type DataKind = 'numeric' | 'categorical' | 'timeseries' | 'multivariate' | 'hierarchical' | 'network' | 'geospatial'

export type CategoryId = 'distribution' | 'relationship' | 'comparison' | 'timeseries' | 'composition' | 'multivariate' | 'hierarchy' | 'uncertainty' | 'geo' | 'network' | 'special'

/** A visual channel the chart needs (x, y, color, …) and what kind of column can fill it. */
export interface RoleSpec {
  key: string
  label: string
  /** Preferred column type: the one auto-mapping tries first. */
  type: ColumnType
  /** Other column types that can fill the role (e.g. a time axis accepts a date or a number). Always includes `type`. */
  accept?: ColumnType[]
  required?: boolean
  /** Multi-column role (e.g. pair-plot variables). Value is an ordered list of column names. */
  multiple?: { min: number; max?: number }
  /** Fill optional roles automatically when a suitable column exists. */
  auto?: boolean
  /**
   * Auto-mapping prefers a column whose name contains one of these texts (alternatives separated by "|"). On an optional role this is also
   * the only way the role is filled automatically: an optional role never takes a column that does not match the hint.
   */
  prefer?: string
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
  /** Data the chart works with; a chart can belong to several kinds. */
  dataKinds: DataKind[]
  /** One-sentence description shown in the lab header. */
  summary: string
  related: string[]
}

/** Observation-level highlight shared between charts in the comparison lab; `rows` are table row indexes (the observation ids). */
export interface Linked {
  rows: readonly number[]
  set: (rows: number[] | null) => void
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
  /** Present in the comparison lab: hover reports observations here and charts mark the ones listed in `rows`. */
  linked?: Linked
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
