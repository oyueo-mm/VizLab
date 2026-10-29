import { ChartArea, ChartColumn, ChartLine, ChartNetwork, ChartPie, ChartScatter, Shapes, type LucideIcon } from 'lucide-react'
import type { CategoryId } from '../viz/types'

export const categoryIcons: Record<CategoryId, LucideIcon> = {
  distribution: ChartArea,
  relationship: ChartScatter,
  comparison: ChartColumn,
  timeseries: ChartLine,
  composition: ChartPie,
  multivariate: ChartNetwork,
  other: Shapes,
}
