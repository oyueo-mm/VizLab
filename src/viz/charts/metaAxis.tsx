import type { ScaleContinuousNumeric } from 'd3'
import { fmt } from '../../lib/format'
import { ratioTicks } from './metaShared'

/** Bottom axis for a log or linear continuous scale; log ticks fall on 1, 2, 5 × 10ᵏ. */
export function EffectAxis({ scale, y, log, label, compact, grid = 0 }: { scale: ScaleContinuousNumeric<number, number>; y: number; log: boolean; label?: string; compact?: boolean; grid?: number }) {
  const [r0, r1] = scale.range()
  const [d0, d1] = scale.domain()
  const ticks = log ? ratioTicks(Math.min(d0, d1), Math.max(d0, d1)) : scale.ticks(compact ? 3 : 6)
  return (
    <g transform={`translate(0,${y})`} className="axis" aria-hidden="true">
      {grid > 0 && ticks.map((v) => <line key={`g${v}`} className="grid" x1={scale(v)} x2={scale(v)} y1={0} y2={-grid} />)}
      {!compact && <line className="domain" x1={r0} x2={r1} />}
      {!compact && ticks.map((v) => <g key={v} transform={`translate(${scale(v)},0)`}><line y2={5} /><text y={18} textAnchor="middle">{fmt(v, 3)}</text></g>)}
      {label && !compact && <text className="axis-label" x={(r0 + r1) / 2} y={42} textAnchor="middle">{label}</text>}
    </g>
  )
}
