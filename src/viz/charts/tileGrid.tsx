import * as d3 from 'd3'
import { RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { getMap } from '../../geo/maps'
import { moveTile, tileGrids, type TileLayout } from '../../geo/tiles'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { classBreaks, classIndex, classMethods, type ClassMethod } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { regionData, regionRoles } from './geoShared'

export interface TileParams {
  /** 'auto' picks the layout whose ids match the data. */
  layout: 'auto' | 'korea' | 'world'
  /** Tiles the user moved, by region id. Empty = the built-in layout. */
  moved: TileLayout
  layoutOf: '' | 'korea' | 'world'
  classMethod: 'continuous' | ClassMethod
  classes: number
  scheme: ColorScheme
  showValues: boolean
  gap: number
  selected: string
}

/** The layout whose region ids cover most of the data's ids. */
export function detectLayout(ids: readonly string[]): 'korea' | 'world' {
  const score = (g: 'korea' | 'world') => ids.filter((i) => i in tileGrids[g].tiles).length
  return score('korea') > score('world') ? 'korea' : 'world'
}

const shortName = (id: string, grid: 'korea' | 'world') => {
  const r = getMap(grid).byId.get(id)
  if (!r) return id
  return grid === 'korea' ? r.name.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '') : id
}

function TileChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<TileParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const gridId = params.layout === 'auto' ? detectLayout([...data.keys()]) : params.layout
  const grid = tileGrids[gridId]
  const layout: TileLayout = useMemo(() => (params.layoutOf === gridId ? { ...grid.tiles, ...params.moved } : grid.tiles), [grid, params.moved, params.layoutOf, gridId])
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const tiles = Object.entries(layout)
  const cols = d3.max(tiles, (t) => t[1][0])! + 1
  const rows = d3.max(tiles, (t) => t[1][1])! + 1
  const pad = compact ? 2 : 10
  // Room above for the legend and readout, below for the footnote.
  const top = compact ? 0 : 56
  const bottom = compact ? 0 : 26
  const cell = Math.max(8, Math.min((width - 2 * pad) / cols, (height - top - bottom - 2 * pad) / rows))
  const ox = (width - cell * cols) / 2
  const oy = top + (height - top - bottom - cell * rows) / 2
  const values = tiles.map(([id]) => data.get(id)?.value).filter((v): v is number => v != null)
  const [lo, hi] = d3.extent(values) as [number, number]
  const scheme = schemes[params.scheme]
  const edges = useMemo(() => (params.classMethod === 'continuous' ? [] : classBreaks(values, params.classMethod, params.classes)), [values.join(','), params.classMethod, params.classes]) // eslint-disable-line react-hooks/exhaustive-deps
  const nclass = Math.max(1, edges.length - 1)
  const colorOf = (v: number) => {
    if (params.classMethod === 'continuous') return scheme.interpolate(scheme.diverging ? (hi === lo ? 0.5 : (v - lo) / (hi - lo)) : 0.08 + 0.92 * (hi === lo ? 0.5 : (v - lo) / (hi - lo)))
    const t = nclass === 1 ? 0.5 : classIndex(v, edges) / (nclass - 1)
    return scheme.interpolate(scheme.diverging ? t : 0.12 + 0.88 * t)
  }
  const marked = new Set(linked?.rows ?? [])
  const unplaced = [...data.keys()].filter((id) => !(id in layout))
  const editable = !compact
  const textOn = (c: string) => (d3.hsl(c).l > 0.55 ? '#121816' : '#ffffff')

  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!values.length) return <ChartMessage>타일 배치에 있는 지역 ID에 값이 없습니다.<small>ID 열이 KR-11 같은 시도 코드나 KOR 같은 국가 코드인지 확인하세요.</small></ChartMessage>

  const cellAt = (e: PointerEvent): [number, number] => {
    const p = localPoint(svgRef.current!, e)
    return [Math.floor((p.x - ox) / cell), Math.floor((p.y - oy) / cell)]
  }
  const onUp = (e: PointerEvent) => {
    if (!drag) return
    const [c, r] = cellAt(e)
    const from = layout[drag.id]
    if (c >= 0 && r >= 0 && c < cols + 1 && r < rows + 1 && (c !== from[0] || r !== from[1])) setParams({ moved: moveTile(layout, drag.id, [c, r]), layoutOf: gridId })
    else setParams({ selected: params.selected === drag.id ? '' : drag.id })
    setDrag(null)
  }
  const gap = params.gap

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg tile-svg" role="img" data-testid="chart-svg" style={{ touchAction: editable ? 'none' : undefined }} aria-label={`타일 그리드 지도: ${grid.label}, 값이 있는 타일 ${values.length}개`}
        onPointerMove={(e) => { if (drag) { const p = localPoint(svgRef.current!, e); setDrag({ ...drag, x: p.x, y: p.y }) } }} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${ox},${oy})`}>
          {tiles.map(([id, [c, r]]) => {
            const d = data.get(id)
            const v = d?.value ?? null
            const fill = v == null ? '#eef1f0' : colorOf(v)
            const on = params.selected === id || (d?.rows.some((q) => marked.has(q)) ?? false)
            const dragging = drag?.id === id
            const x = dragging ? drag!.x - ox - cell / 2 : c * cell
            const y = dragging ? drag!.y - oy - cell / 2 : r * cell
            const label = shortName(id, gridId)
            return (
              <g key={id} data-testid="tile" data-id={id} data-col={c} data-row={r} data-value={v ?? ''} opacity={dragging ? 0.85 : 1} style={{ cursor: editable ? 'grab' : undefined }}
                onPointerDown={editable ? (e) => { const p = localPoint(svgRef.current!, e); svgRef.current!.setPointerCapture(e.pointerId); setDrag({ id, x: p.x, y: p.y }); hide() } : undefined}
                onPointerEnter={compact ? undefined : (e) => { if (drag) return; linked?.set(d?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{getMap(gridId).byId.get(id)?.name ?? id}</b> <small>{id}</small><br />{v != null ? `${roleColumn(mapping, 'value')}: ${fmt(v)}` : '값 없음'}<br />끌어서 다른 칸으로 옮기기</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}>
                <rect x={x + gap / 2} y={y + gap / 2} width={cell - gap} height={cell - gap} rx={Math.min(6, cell * 0.12)} fill={fill} stroke={on ? '#121816' : 'none'} strokeWidth={on ? 2 : 0} />
                {cell >= 22 && (
                  <text x={x + cell / 2} y={y + cell / 2 + (params.showValues && v != null && cell >= 34 ? -3 : 4)} textAnchor="middle" fontSize={Math.max(9, Math.min(13, cell * 0.28))} fontWeight={600} fill={v == null ? '#8a9692' : textOn(fill)} pointerEvents="none">{label}</text>
                )}
                {params.showValues && v != null && cell >= 34 && <text x={x + cell / 2} y={y + cell / 2 + 11} textAnchor="middle" fontSize={Math.max(8, Math.min(11, cell * 0.22))} fill={textOn(fill)} pointerEvents="none">{fmt(v, 3)}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {params.classMethod === 'continuous'
            ? <div className="color-legend"><span>{fmt(lo, 3)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(scheme.diverging ? v : 0.08 + 0.92 * v)).join(',')})` }} /><span>{fmt(hi, 3)}</span></div>
            : <Legend items={edges.slice(0, -1).map((e, i) => ({ key: `${fmt(e, 3)} – ${fmt(edges[i + 1], 3)}`, color: colorOf((e + edges[i + 1]) / 2) }))} title={roleColumn(mapping, 'value') ?? ''} />}
          <Readout items={[{ label: '타일', value: `${values.length} / ${tiles.length}` }, { label: '범위', value: `${fmt(lo, 3)} – ${fmt(hi, 3)}` }]} />
          <p className="chart-footnote" style={{ left: 8, top: 'auto', bottom: 4 }}>타일 위치는 이웃 관계를 대강 살린 배치일 뿐 실제 위치·크기·경계가 아닙니다.</p>
          {unplaced.length > 0 && <p className="chart-warning" role="status">배치에 없는 지역 ID {unplaced.length}개는 그리지 않았습니다 ({unplaced.slice(0, 3).join(', ')}{unplaced.length > 3 ? '…' : ''}).</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function TileControls({ params, setParams, table, mapping }: ControlsProps<TileParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const gridId = params.layout === 'auto' ? detectLayout([...data.keys()]) : params.layout
  const method = classMethods.find((m) => m.value === params.classMethod)
  const movedCount = params.layoutOf === gridId ? Object.keys(params.moved).length : 0
  return (
    <>
      <ControlGroup title="배치">
        <Select label="타일 배치" value={params.layout} onChange={(layout) => setParams({ layout, moved: {}, layoutOf: '' })} testId="ctl-tile-layout"
          options={[{ value: 'auto', label: `자동 (${tileGrids[gridId].label})` }, { value: 'korea', label: tileGrids.korea.label }, { value: 'world', label: tileGrids.world.label }]} />
        <Hint>모든 지역을 같은 크기의 정사각형으로 그리므로 면적이 큰 지역이 시선을 독점하지 않습니다. 타일을 끌어 다른 칸에 놓으면 그 칸의 타일과 자리를 바꿉니다.</Hint>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!movedCount} onClick={() => setParams({ moved: {}, layoutOf: '' })} data-testid="tile-reset"><RotateCcw size={14} aria-hidden="true" />배치 초기화{movedCount ? ` (${movedCount}곳 이동됨)` : ''}</button>
        <Slider label="타일 간격" value={params.gap} min={0} max={10} onChange={(gap) => setParams({ gap })} format={(v) => `${v}px`} />
        <Toggle label="값 숫자 표시" checked={params.showValues} onChange={(showValues) => setParams({ showValues })} />
      </ControlGroup>
      <ControlGroup title="색상 구분">
        <Select label="분할 기준" value={params.classMethod} onChange={(classMethod) => setParams({ classMethod })} testId="ctl-class-method"
          options={[{ value: 'continuous', label: '연속 (구분 없음)' }, ...classMethods.map((m) => ({ value: m.value as 'continuous' | ClassMethod, label: m.label }))]} />
        {method && <Hint>{method.hint}</Hint>}
        <Slider label="계급 수" value={params.classes} min={2} max={9} onChange={(classes) => setParams({ classes })} disabled={params.classMethod === 'continuous'} />
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).map((k) => ({ value: k, label: schemes[k].name }))} />
      </ControlGroup>
    </>
  )
}

export const tileGridModule: VizModule<TileParams> = {
  roles: regionRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { layout: 'auto', moved: {}, layoutOf: '', classMethod: 'quantile', classes: 5, scheme: 'teal', showValues: true, gap: 3, selected: '' },
  Chart: TileChart,
  Controls: TileControls,
  hint: '타일을 끌어 자리를 바꿔 보세요 · 배치는 실제 지리가 아니라 이웃 관계를 대강 살린 것입니다 · 같은 데이터를 코로플레스와 비교',
}
