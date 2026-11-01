import { Atom, BrainCircuit, ChartArea, ChartColumn, ChartLine, ChartNetwork, ChartPie, ChartScatter, Dna, Landmark, Map, Network, Puzzle, Sigma, Waypoints, type LucideIcon } from 'lucide-react'
import type { CategoryId } from '../viz/types'

export const categoryIcons: Record<CategoryId, LucideIcon> = {
  distribution: ChartArea,
  relationship: ChartScatter,
  comparison: ChartColumn,
  timeseries: ChartLine,
  composition: ChartPie,
  multivariate: ChartNetwork,
  hierarchy: Network,
  uncertainty: Sigma,
  geo: Map,
  network: Waypoints,
  special: Puzzle,
  science: Atom,
  bio: Dna,
  finance: Landmark,
  ml: BrainCircuit,
}
