import * as d3 from 'd3'
import { useMemo, useState, type ReactNode } from 'react'
import { ChartMessage, Legend } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider } from '../../components/controls'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt, tick } from '../../lib/format'
import { columnIndex, toLabel, toNumber, uniqueLabels } from '../../data/table'
import { pearson } from '../../stats/descriptive'
import { histogram } from '../../stats/histogram'
import { kde, kdeGrid, silvermanBandwidth } from '../../stats/kde'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { paddedDomain } from './shared'

export interface PairParams {
  diagonal: 'hist' | 'kde'
  upper: 'scatter' | 'corr'
  size: number
  opacity: number
}

function PairChart({ table, mapping, params, width, height, compact }: ChartProps<PairParams>) {
  const vars = roleColumns(mapping, 'vars')
  const colorCol = roleColumn(mapping, 'color')
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [active, setActive] = useState<[number, number] | null>(null)

  const data = useMemo(() => {
    const idx = vars.map((v) => columnIndex(table, v))
    const ci = columnIndex(table, colorCol)
    const rows: { i: number; v: number[]; g: string }[] = []
    table.rows.forEach((r, i) => {
      const v = idx.map((k) => toNumber(r[k]))
      if (v.every((x) => x != null)) rows.push({ i, v: v as number[], g: ci >= 0 ? toLabel(r[ci]) : '' })
    })
    return rows
  }, [table, vars, colorCol])
  const groups = useMemo(() => uniqueLabels(data.map((d) => d.g)), [data])
  const color = useMemo(() => categoryColor(groups), [groups])
  const k = vars.length
  const labelSpace = compact ? 0 : 86
  const topSpace = compact ? 0 : 30
  const cell = Math.max(20, Math.floor(Math.min(width - labelSpace - 12, height - topSpace - 44) / Math.max(1, k)))
  const pad = compact ? 2 : 6
  const scales = useMemo(() => vars.map((_, j) => d3.scaleLinear().domain(paddedDomain(data.map((d) => d.v[j]), 0.08)).nice(4).range([pad, cell - pad])), [vars, data, cell, pad])

  const diagonals = useMemo(() => vars.map((_, j) => {
    const sx = scales[j]
    const byGroup = (groups.length ? groups : ['']).map((g) => ({ g, vals: data.filter((d) => d.g === g || !groups.length).map((d) => d.v[j]) }))
    if (params.diagonal === 'hist') {
      const all = data.map((d) => d.v[j])
      const { edges } = histogram(all, 12)
      const hs = byGroup.map(({ g, vals }) => ({ g, bins: d3.bin().domain([edges[0], edges[edges.length - 1]]).thresholds(edges.slice(1, -1))(vals) }))
      const max = d3.max(hs, (h) => d3.max(h.bins, (b) => b.length)) ?? 1
      return { kind: 'hist' as const, hs, max, sx }
    }
    const [lo, hi] = sx.domain()
    const grid = kdeGrid(lo, hi, 0, 60)
    const curves = byGroup.map(({ g, vals }) => ({ g, ys: vals.length > 1 ? kde(vals, silvermanBandwidth(vals), 'gaussian', grid) : grid.map(() => 0) }))
    const max = d3.max(curves, (c) => d3.max(c.ys)) || 1
    return { kind: 'kde' as const, curves, grid, max, sx }
  }), [vars, scales, data, groups, params.diagonal])

  const correlations = useMemo(() => vars.map((_, a) => vars.map((__, b) => pearson(data.map((d) => d.v[a]), data.map((d) => d.v[b])))), [vars, data])

  const marks = useMemo(() => {
    const out: ReactNode[] = []
    for (let row = 0; row < k; row++) {
      for (let col = 0; col < k; col++) {
        const key = `${row}-${col}`
        const tx = labelSpace + col * cell
        const ty = row * cell
        let content: ReactNode
        if (row === col) {
          const dg = diagonals[col]
          const h = cell - 2 * pad
          if (dg.kind === 'hist') {
            content = dg.hs.map(({ g, bins }) => bins.map((b, bi) => (
              <rect key={`${g}${bi}`} x={dg.sx(b.x0!) + 0.5} width={Math.max(0, dg.sx(b.x1!) - dg.sx(b.x0!) - 1)} y={cell - pad - (b.length / dg.max) * h} height={(b.length / dg.max) * h}
                fill={groups.length ? color(g) : '#2a8c82'} fillOpacity={groups.length ? 0.45 : 0.75} />
            )))
          } else {
            content = dg.curves.map(({ g, ys }) => (
              <path key={g} d={d3.area<number>().x((_, i) => dg.sx(dg.grid[i])).y0(cell - pad).y1((v) => cell - pad - (v / dg.max) * h)(ys) ?? ''}
                fill={groups.length ? color(g) : '#2a8c82'} fillOpacity={0.3} stroke={groups.length ? color(g) : '#2a8c82'} strokeWidth={1.4} />
            ))
          }
        } else if (row < col && params.upper === 'corr') {
          const r = correlations[row][col]
          const fill = schemes.rdbu.interpolate((r + 1) / 2)
          content = (
            <>
              <rect x={pad} y={pad} width={cell - 2 * pad} height={cell - 2 * pad} fill={fill} fillOpacity={0.55} rx={3} />
              {!compact && <text x={cell / 2} y={cell / 2} dy="0.35em" textAnchor="middle" className="corr-label" style={{ fontSize: Math.min(20, cell / 4) }}>{fmt(r, 2)}</text>}
            </>
          )
        } else {
          const sx = scales[col]
          const sy = d3.scaleLinear().domain(scales[row].domain()).range([cell - pad, pad])
          content = data.map((d) => (
            <circle key={d.i} cx={sx(d.v[col])} cy={sy(d.v[row])} r={compact ? 1 : params.size} fill={groups.length ? color(d.g) : '#2a8c82'} fillOpacity={params.opacity}
              onPointerEnter={compact ? undefined : () => setHoverRow(d.i)} />
          ))
        }
        out.push(
          <g key={key} transform={`translate(${tx},${ty})`} data-cell={key}
            onPointerEnter={compact ? undefined : () => setActive([row, col])}>
            <rect className="pair-cell" width={cell} height={cell} />
            {content}
          </g>,
        )
      }
    }
    return out
  }, [k, cell, labelSpace, diagonals, correlations, data, scales, groups, color, params.upper, params.size, params.opacity, pad, compact])

  if (k < 2) return <ChartMessage>변수를 2개 이상 선택하세요. (데이터 탭 › 변수)</ChartMessage>
  if (!data.length) return <ChartMessage>선택한 변수가 모두 채워진 행이 없습니다.</ChartMessage>

  const hovered = hoverRow != null ? data.find((d) => d.i === hoverRow) : null
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" aria-label={`페어 플롯: ${vars.join(', ')}`} data-testid="chart-svg" onPointerLeave={() => { setHoverRow(null); setActive(null) }}>
        <g transform={`translate(4,${topSpace})`}>
          {marks}
          {hovered && vars.map((_, row) => vars.map((__, col) => {
            if (row === col || (row < col && params.upper === 'corr')) return null
            const sy = d3.scaleLinear().domain(scales[row].domain()).range([cell - pad, pad])
            return <circle key={`${row}${col}`} className="pair-highlight" cx={labelSpace + col * cell + scales[col](hovered.v[col])} cy={row * cell + sy(hovered.v[row])} r={params.size + 2.5} />
          }))}
          {!compact && vars.map((v, j) => (
            <g key={v} className="axis">
              <text className={`pair-label ${active && (active[0] === j) ? 'is-active' : ''}`} x={labelSpace - 8} y={j * cell + cell / 2} textAnchor="end" dy="0.32em">{v.length > 9 ? `${v.slice(0, 8)}…` : v}<title>{v}</title></text>
              <text className={`pair-label ${active && (active[1] === j) ? 'is-active' : ''}`} x={labelSpace + j * cell + cell / 2} y={k * cell + 16} textAnchor="middle">{v.length > Math.floor(cell / 13) ? `${v.slice(0, Math.max(2, Math.floor(cell / 13) - 1))}…` : v}<title>{v}</title></text>
              <text className="pair-tick" x={labelSpace + j * cell + pad} y={k * cell + 30} textAnchor="start">{tick(scales[j].domain()[0])}</text>
              <text className="pair-tick" x={labelSpace + (j + 1) * cell - pad} y={k * cell + 30} textAnchor="end">{tick(scales[j].domain()[1])}</text>
            </g>
          ))}
        </g>
      </svg>
      {!compact && (
        <>
          {colorCol && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} title={colorCol} />}
          {active && active[0] !== active[1] && (
            <dl className="chart-readout">
              <div><dt>쌍</dt><dd>{vars[active[1]]} × {vars[active[0]]}</dd></div>
              <div><dt>피어슨 r</dt><dd>{fmt(correlations[active[0]][active[1]], 3)}</dd></div>
            </dl>
          )}
        </>
      )}
    </div>
  )
}

function PairControls({ params, setParams }: ControlsProps<PairParams>) {
  return (
    <>
      <ControlGroup title="행렬 구성">
        <Segmented label="대각선" value={params.diagonal} onChange={(diagonal) => setParams({ diagonal })} testId="ctl-diagonal"
          options={[{ value: 'hist', label: '히스토그램' }, { value: 'kde', label: 'KDE' }]} />
        <Segmented label="위쪽 삼각형" value={params.upper} onChange={(upper) => setParams({ upper })} testId="ctl-upper"
          options={[{ value: 'scatter', label: '산점도' }, { value: 'corr', label: '상관계수' }]} />
        <Hint>변수 개수와 종류는 데이터 탭의 ‘변수’ 목록에서 바꿉니다. 위·아래 삼각형은 축만 뒤바뀐 같은 정보입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="점 표시">
        <Slider label="점 크기" value={params.size} min={0.8} max={5} step={0.2} onChange={(size) => setParams({ size })} testId="ctl-size" />
        <Slider label="투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      </ControlGroup>
    </>
  )
}

export const pairplotModule: VizModule<PairParams> = {
  roles: [
    { key: 'vars', label: '변수', type: 'number', required: true, multiple: { min: 2, max: 6 } },
    { key: 'color', label: '색상', type: 'category', auto: true },
  ],
  datasets: ['flowers', 'cars', 'pos-corr', 'neg-corr'],
  defaultParams: { diagonal: 'hist', upper: 'scatter', size: 2.2, opacity: 0.6 },
  Chart: PairChart,
  Controls: PairControls,
  hint: '점에 마우스를 올리면 같은 관측이 모든 칸에서 강조됩니다',
}
