import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, NumberField, Segmented, Slider, Toggle } from '../../components/controls'
import { fmt } from '../../lib/format'
import { horizonLayers } from '../../stats/horizon'
import { mean } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { seriesOf } from './line'
import { isDateColumn, pointRows, xFormat } from './shared'

export interface HorizonParams {
  bands: number
  baseline: 'zero' | 'mean' | 'first' | 'custom'
  customBaseline: number
  posColor: string
  negColor: string
  /** Show the plain area chart above each horizon strip. */
  compare: boolean
  sharedScale: boolean
  /** Strip height in px (0 = fit to the available height). */
  rowHeight: number
}

/** Light-to-dark shades of a base colour, one per band. */
export function shades(base: string, bands: number) {
  return Array.from({ length: bands }, (_, k) => d3.interpolateRgb('#ffffff', base)(0.28 + (0.72 * k) / Math.max(1, bands - 1)))
}

function HorizonChart({ table, mapping, params, width, height, compact }: ChartProps<HorizonParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const sCol = roleColumn(mapping, 'series')
  const isDate = isDateColumn(table, xCol)
  const fx = xFormat(isDate)
  const pts = useMemo(() => pointRows(table, xCol, yCol, sCol), [table, xCol, yCol, sCol])
  const all = useMemo(() => seriesOf(pts), [pts])
  const m = margins(compact, compact ? { top: 6, bottom: 8, left: 8, right: 8 } : { left: width < 520 ? 56 : 84, right: 16, top: width < 520 ? 72 : 44 })
  const iw = Math.max(10, width - m.left - m.right)
  const axisH = compact ? 0 : 34
  const rows = all.length
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()
  const bands = Math.max(1, Math.min(6, params.bands))

  const prepared = useMemo(() => all.map((s) => {
    const ys = s.pts.map((p) => p.y)
    const baseline = params.baseline === 'zero' ? 0 : params.baseline === 'mean' ? mean(ys) : params.baseline === 'first' ? ys[0] ?? 0 : params.customBaseline
    return { ...s, baseline }
  }), [all, params.baseline, params.customBaseline])
  const globalMax = Math.max(1e-12, ...prepared.flatMap((s) => s.pts.map((p) => Math.abs(p.y - s.baseline))))
  const layers = useMemo(() => prepared.map((s) => horizonLayers(s.pts.map((p) => p.y), s.baseline, bands, params.sharedScale ? globalMax : undefined)), [prepared, bands, params.sharedScale, globalMax])

  if (!xCol || !yCol) return <ChartMessage>X축(날짜 또는 숫자)과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 점이 없습니다.</ChartMessage>
  const [x0, x1] = d3.extent(pts, (p) => p.x) as [number, number]
  const x = d3.scaleLinear().domain([x0, x1 === x0 ? x0 + 1 : x1]).range([0, iw])
  const avail = Math.max(20, height - m.top - m.bottom - axisH)
  const gap = compact ? 2 : 6
  const rowH = params.rowHeight > 0 ? params.rowHeight : Math.max(compact ? 8 : 26, (avail - gap * (rows - 1)) / rows)
  const stripH = params.compare && !compact ? Math.max(14, rowH * 0.42) : rowH
  const areaH = params.compare && !compact ? rowH - stripH - 3 : 0
  const total = rows * rowH + (rows - 1) * gap
  const pos = shades(params.posColor, bands)
  const neg = shades(params.negColor, bands)
  const svgH = Math.max(height, m.top + total + axisH + m.bottom)

  const hoverRow = (px: number, py: number) => {
    const gx = x.invert(px - m.left)
    const all2 = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b)
    const nx = all2[d3.bisectCenter(all2, gx)]
    setHoverX(nx)
    show(px, py, <><b>{xCol} = {fx(nx)}</b>{prepared.map((s, i) => {
      const k = s.pts.findIndex((p) => p.x === nx)
      if (k < 0) return null
      const dev = s.pts[k].y - s.baseline
      const band = Math.min(bands, Math.ceil(Math.abs(dev) / layers[i].bandWidth - 1e-9))
      return <span key={s.key}><br />{s.key || yCol}: {fmt(s.pts[k].y)}{dev !== 0 ? ` (기준 ${dev > 0 ? '+' : '−'}${fmt(Math.abs(dev))}, ${Math.max(1, band)}층${Math.abs(dev) > bands * layers[i].bandWidth ? '·포화' : ''})` : ''}</span>
    })}</>)
  }

  return (
    <div className="chart-root" style={{ overflowY: svgH > height ? 'auto' : undefined }}>
      <svg ref={svgRef} width={width} height={svgH} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`호라이즌 차트: ${yCol}, ${bands}개 층`}
        onPointerMove={compact ? undefined : (e) => { const p = localPoint(svgRef.current!, e); if (p.x - m.left >= 0 && p.x - m.left <= iw) hoverRow(p.x, p.y); else { hide(); setHoverX(null) } }}
        onPointerLeave={() => { hide(); setHoverX(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {prepared.map((s, i) => {
            const top = i * (rowH + gap)
            const L = layers[i]
            const baseY = top + areaH + (areaH ? 3 : 0) + stripH
            const stripBase = baseY
            const xsP = s.pts.map((p) => x(p.x))
            const layerPath = (vals: number[]) => d3.area<number>().x((_, k) => xsP[k]).y0(stripBase).y1((v) => stripBase - v * stripH).curve(d3.curveStepAfter)(vals) ?? ''
            const ys = s.pts.map((p) => p.y)
            const [lo, hi] = d3.extent([...ys, s.baseline]) as [number, number]
            const ya = d3.scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([top + areaH, top])
            return (
              <g key={s.key} className="marks" data-testid="horizon-row">
                {areaH > 0 && (
                  <g aria-label={`${s.key} 원본 영역 그래프`} data-testid="horizon-raw">
                    <path d={d3.area<(typeof s.pts)[number]>().x((p) => x(p.x)).y0(ya(s.baseline)).y1((p) => ya(p.y)).curve(d3.curveStepAfter)(s.pts) ?? ''} fill="#8a9692" fillOpacity={0.3} stroke="#5b6763" strokeWidth={1} />
                    <line x1={0} x2={iw} y1={ya(s.baseline)} y2={ya(s.baseline)} stroke="#8a9692" strokeDasharray="3 3" />
                  </g>
                )}
                <rect x={0} y={stripBase - stripH} width={iw} height={stripH} fill="#f6f8f7" />
                {L.pos.map((vals, k) => <path key={`p${k}`} d={layerPath(vals)} fill={pos[k]} data-testid="horizon-band" />)}
                {L.neg.map((vals, k) => <path key={`n${k}`} d={layerPath(vals)} fill={neg[k]} data-testid="horizon-band" />)}
                {!compact && <text className="cat-label" x={-8} y={top + rowH / 2} dy="0.35em" textAnchor="end"><title>{s.key}</title>{(s.key || yCol).length > 9 ? `${(s.key || yCol).slice(0, 8)}…` : s.key || yCol}</text>}
                {hoverX != null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={top} y2={baseY} />}
              </g>
            )
          })}
          {!compact && <AxisBottom scale={x} y={total + 6} label={xCol} compact={compact} date={isDate} />}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: '기준 위 (진할수록 기준에서 멂)', color: pos[pos.length - 1] }, { key: '기준 아래', color: neg[neg.length - 1] }]} />
          <Readout items={[{ label: '한 층', value: `${fmt(layers[0]?.bandWidth)}${params.sharedScale ? '' : ' (계열마다 다름)'}` }, { label: '층', value: bands }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function HorizonControls({ params, setParams }: ControlsProps<HorizonParams>) {
  return (
    <>
      <ControlGroup title="층 나누기">
        <Slider label="층(구간) 수" value={params.bands} min={1} max={6} onChange={(bands) => setParams({ bands })} testId="ctl-bands" />
        <Hint>기준에서 가장 멀리 떨어진 값까지의 거리를 층 수로 나눠, 각 층을 같은 위치에 겹쳐 그립니다. 색이 진할수록 기준에서 더 멉니다.</Hint>
        <Segmented label="기준값" value={params.baseline} onChange={(baseline) => setParams({ baseline })} testId="ctl-baseline"
          options={[{ value: 'zero', label: '0' }, { value: 'mean', label: '평균' }, { value: 'first', label: '첫 값' }, { value: 'custom', label: '직접' }]} />
        {params.baseline === 'custom' && <NumberField label="기준값 입력" value={params.customBaseline} onChange={(customBaseline) => setParams({ customBaseline })} testId="ctl-custom-baseline" />}
        <Toggle label="계열 공통 척도" description="끄면 계열마다 자기 범위로 층을 나눕니다" checked={params.sharedScale} onChange={(sharedScale) => setParams({ sharedScale })} testId="ctl-shared" />
      </ControlGroup>
      <ControlGroup title="표현">
        <ColorField label="기준 위 (양수) 색" value={params.posColor} onChange={(posColor) => setParams({ posColor })} testId="ctl-pos" />
        <ColorField label="기준 아래 (음수) 색" value={params.negColor} onChange={(negColor) => setParams({ negColor })} testId="ctl-neg" />
        <Toggle label="원본 영역 그래프와 비교" description="각 띠 위에 같은 값을 영역 그래프로 그립니다" checked={params.compare} onChange={(compare) => setParams({ compare })} testId="ctl-compare" />
        <Slider label="띠 높이" value={params.rowHeight} min={0} max={80} step={4} onChange={(rowHeight) => setParams({ rowHeight })} format={(v) => (v === 0 ? '자동' : `${v}px`)} />
      </ControlGroup>
    </>
  )
}

export const horizonModule: VizModule<HorizonParams> = {
  roles: [
    { key: 'x', label: 'X축 (날짜·순서)', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'y', label: 'Y축 (값)', type: 'number', required: true },
    { key: 'series', label: '계열', type: 'category', auto: true },
  ],
  datasets: ['sensors', 'visits-dated', 'streams', 'timeseries'],
  defaultParams: { bands: 3, baseline: 'zero', customBaseline: 0, posColor: '#2f6fd0', negColor: '#d4403a', compare: false, sharedScale: false, rowHeight: 0 },
  Chart: HorizonChart,
  Controls: HorizonControls,
  hint: '진한 층일수록 기준에서 멀리 떨어진 값 · 마우스를 올려 시점별 값과 층 확인 · 원본 영역 그래프와 비교',
}
