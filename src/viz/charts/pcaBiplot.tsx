import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { pca, type PcaResult } from '../../stats/pca'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface PcaParams {
  center: boolean
  scale: boolean
  /** Components on the horizontal and vertical axes (1-based). */
  pcX: number
  pcY: number
  points: boolean
  arrows: boolean
  labels: boolean
  arrowScaling: 'loadings' | 'unit'
  arrowGain: number
  size: number
  hidden: string[]
}

export interface PcaData { res: PcaResult; vars: string[]; groups: string[]; rows: number[]; skipped: number }

/** Runs PCA on the mapped variables, skipping rows with a missing value (their indexes are not scored). */
export function runPca(table: DataTable, mapping: Mapping, center: boolean, scale: boolean): PcaData | null {
  const vars = roleColumns(mapping, 'vars').filter((v) => columnIndex(table, v) >= 0)
  const gi = columnIndex(table, roleColumn(mapping, 'group'))
  const idx = vars.map((v) => columnIndex(table, v))
  const data: number[][] = []
  const rows: number[] = []
  const groups: string[] = []
  let skipped = 0
  table.rows.forEach((r, i) => {
    const v = idx.map((c) => toNumber(r[c]))
    if (v.some((x) => x == null)) { skipped++; return }
    data.push(v as number[])
    rows.push(i)
    groups.push(gi >= 0 ? toLabel(r[gi]) : '')
  })
  const res = pca(data, { center, scale })
  return res ? { res, vars, groups, rows, skipped } : null
}

function PcaChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<PcaParams>) {
  const data = useMemo(() => runPca(table, mapping, params.center, params.scale), [table, mapping, params.center, params.scale])
  const groupCol = roleColumn(mapping, 'group')
  const keys = useMemo(() => [...new Set(data?.groups ?? [])], [data])
  const color = useMemo(() => categoryColor(keys), [keys])
  const narrow = width < 520
  const m = margins(compact, compact ? {} : { right: narrow ? 20 : 34, top: narrow ? 78 : 34 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  if (roleColumns(mapping, 'vars').length < 2) return <ChartMessage>변수(숫자형 열)를 2개 이상 선택하세요.</ChartMessage>
  if (!data) return <ChartMessage>주성분 분석에는 값이 모두 있는 행이 3개 이상 필요합니다.</ChartMessage>
  const { res, vars } = data
  const px = Math.min(Math.max(1, params.pcX), res.p) - 1
  const py = Math.min(Math.max(1, params.pcY), res.p) - 1
  const sx = res.scores.map((s) => s[px])
  const sy = res.scores.map((s) => s[py])
  const ext = (v: number[]) => { const lim = Math.max(1e-9, ...v.map(Math.abs)); return lim * 1.12 }
  // The same data range on both axes would distort nothing; each axis spans its own scores symmetrically about 0.
  const lx = ext(sx)
  const ly = ext(sy)
  const x = d3.scaleLinear().domain([-lx, lx]).range([0, iw])
  const y = d3.scaleLinear().domain([-ly, ly]).range([ih, 0])
  // Arrow k: loadings (eigenvector × √eigenvalue) or unit eigenvectors, multiplied by one common factor so the longest arrow
  // reaches ~85 % of the score range; the factor is shown in the control panel.
  const raw = vars.map((_, j) => (params.arrowScaling === 'loadings' ? [res.loadings[px][j], res.loadings[py][j]] : [res.vectors[px][j], res.vectors[py][j]]))
  const longest = Math.max(1e-9, ...raw.map(([a, b]) => Math.hypot(a / lx, b / ly)))
  const gain = (0.85 / longest) * params.arrowGain
  const marked = new Set(linked?.rows ?? [])
  const r = compact ? 1.8 : params.size
  const hiddenSet = new Set(params.hidden)

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`PCA 바이플롯: PC${px + 1} ${pct(res.explained[px])}, PC${py + 1} ${pct(res.explained[py])}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={compact ? undefined : `PC${px + 1} (${pct(res.explained[px])})`} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={compact ? undefined : `PC${py + 1} (${pct(res.explained[py])})`} compact={compact} />
          <line className="biplot-axis" x1={x(0)} x2={x(0)} y1={0} y2={ih} aria-hidden="true" />
          <line className="biplot-axis" x1={0} x2={iw} y1={y(0)} y2={y(0)} aria-hidden="true" />
          {params.points && data.rows.map((row, i) => {
            const g = data.groups[i]
            if (hiddenSet.has(g)) return null
            const on = marked.has(row)
            return (
              <circle key={row} className="mark-point" data-testid="pca-point" cx={x(sx[i])} cy={y(sy[i])} r={on ? r + 3 : r} fill={on ? '#e07a3f' : color(g)} fillOpacity={on ? 1 : 0.7} stroke="#fff" strokeWidth={on ? 1.6 : 0.7}
                onPointerEnter={compact ? undefined : (e) => {
                  linked?.set([row])
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{groupCol ? `${g} · ` : ''}{row + 1}번째 행</b><br />PC{px + 1} = {fmt(sx[i], 3)}<br />PC{py + 1} = {fmt(sy[i], 3)}</>)
                }} onPointerLeave={() => { linked?.set(null); hide() }} />
            )
          })}
          {params.arrows && vars.map((v, j) => {
            const ex = x(raw[j][0] * gain)
            const ey = y(raw[j][1] * gain)
            const len = Math.hypot(ex - x(0), ey - y(0))
            const ang = Math.atan2(ey - y(0), ex - x(0))
            const head = compact ? 4 : 8
            return (
              <g key={v} className="biplot-arrow" data-testid="pca-arrow"
                onPointerEnter={compact ? undefined : (e) => {
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{v}</b><br />PC{px + 1} 가중치 {fmt(res.vectors[px][j], 3)}<br />PC{py + 1} 가중치 {fmt(res.vectors[py][j], 3)}<br />{params.scale ? '상관계수' : '적재량'} {fmt(res.loadings[px][j], 3)}, {fmt(res.loadings[py][j], 3)}</>)
                }} onPointerLeave={hide}>
                <line x1={x(0)} y1={y(0)} x2={ex} y2={ey} stroke="#c4602a" strokeWidth={compact ? 1.2 : 2} />
                <path d={`M${ex},${ey} L${ex - head * Math.cos(ang - 0.4)},${ey - head * Math.sin(ang - 0.4)} L${ex - head * Math.cos(ang + 0.4)},${ey - head * Math.sin(ang + 0.4)}Z`} fill="#c4602a" />
                <line x1={x(0)} y1={y(0)} x2={ex} y2={ey} stroke="transparent" strokeWidth={12} />
                {params.labels && !compact && (
                  <text className="biplot-label" x={ex + Math.cos(ang) * 8} y={ey + Math.sin(ang) * 8} dy="0.35em" textAnchor={Math.cos(ang) >= 0 ? 'start' : 'end'}>{v}{len < 1 ? '' : ''}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={keys.map((k) => ({ key: k, color: color(k) }))} hidden={params.hidden} title={groupCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />}
          <Readout items={[{ label: `PC${px + 1}`, value: pct(res.explained[px]) }, { label: `PC${py + 1}`, value: pct(res.explained[py]) }, ...(narrow ? [] : [{ label: '누적', value: pct(res.explained[px] + (py === px ? 0 : res.explained[py])) }, { label: 'n', value: res.n }])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function PcaControls({ params, setParams, table, mapping }: ControlsProps<PcaParams>) {
  const data = useMemo(() => runPca(table, mapping, params.center, params.scale), [table, mapping, params.center, params.scale])
  const p = data?.res.p ?? 2
  const comps = Array.from({ length: p }, (_, i) => ({ value: String(i + 1), label: `PC${i + 1}${data ? ` (${pct(data.res.explained[i])})` : ''}` }))
  const px = Math.min(params.pcX, p) - 1
  const py = Math.min(params.pcY, p) - 1
  return (
    <>
      <ControlGroup title="전처리">
        <Toggle label="중심화 (평균 빼기)" description="끄면 원점을 기준으로 분해하므로 첫 주성분이 평균 위치를 가리킵니다" checked={params.center} onChange={(center) => setParams({ center })} testId="ctl-center" />
        <Toggle label="표준화 (표준편차로 나누기)" description="단위가 다른 변수를 함께 쓸 때 필요합니다 — 상관행렬 PCA" checked={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale" />
        {data && data.skipped > 0 && <Hint>값이 비어 있는 {data.skipped}개 행은 계산에서 제외했습니다.</Hint>}
        {data && data.res.constant.length > 0 && <Hint>분산이 0인 변수({data.res.constant.map((j) => data.vars[j]).join(', ')})는 표준화할 수 없어 그대로 둡니다.</Hint>}
      </ControlGroup>
      <ControlGroup title="주성분과 표시">
        <Select label="가로축 성분" value={String(Math.min(params.pcX, p))} onChange={(v) => setParams({ pcX: Number(v) })} options={comps} testId="ctl-pcx" />
        <Select label="세로축 성분" value={String(Math.min(params.pcY, p))} onChange={(v) => setParams({ pcY: Number(v) })} options={comps} testId="ctl-pcy" />
        <Toggle label="관측값(점) 표시" checked={params.points} onChange={(points) => setParams({ points })} testId="ctl-points" />
        <Toggle label="변수 벡터(화살표) 표시" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
        <Toggle label="변수 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Slider label="점 크기" value={params.size} min={2} max={8} step={0.5} onChange={(size) => setParams({ size })} />
      </ControlGroup>
      <ControlGroup title="화살표 스케일">
        <Segmented label="화살표 길이" value={params.arrowScaling} onChange={(arrowScaling) => setParams({ arrowScaling })} testId="ctl-arrow-scaling"
          options={[{ value: 'loadings', label: '적재량' }, { value: 'unit', label: '단위 고유벡터' }]} />
        <Slider label="배율 보정" value={params.arrowGain} min={0.4} max={1.4} step={0.05} onChange={(arrowGain) => setParams({ arrowGain })} format={(v) => `×${v.toFixed(2)}`} />
        <Hint>
          {params.arrowScaling === 'loadings'
            ? `화살표 = 고유벡터 × √고유값 (적재량). ${params.scale ? '표준화했으므로 변수와 성분의 상관계수와 같습니다.' : ''}`
            : '화살표 = 길이 1인 고유벡터. 변수의 상대적 기여 방향만 보여 줍니다.'}
          {' '}모든 화살표에 같은 배율을 곱해 가장 긴 화살표가 점의 범위 안에 들어오게 하므로, 점과 화살표의 길이는 서로 다른 단위입니다. 방향과 화살표끼리의 길이만 비교하세요.
        </Hint>
      </ControlGroup>
      {data && (
        <ControlGroup title="설명분산비" defaultOpen={false}>
          <StatTable rows={[['성분', '고유값', '설명분산', '누적'], ...data.res.explained.map((e, i) => [`PC${i + 1}`, fmt(data.res.eigenvalues[i], 3), pct(e), pct(data.res.explained.slice(0, i + 1).reduce((s, v) => s + v, 0))])]} />
          <StatTable rows={[['변수', `PC${px + 1}`, `PC${py + 1}`], ...data.vars.map((v, j) => [v, fmt(data.res.vectors[px][j], 3), fmt(data.res.vectors[py][j], 3)])]} caption="고유벡터(가중치)" />
        </ControlGroup>
      )}
    </>
  )
}

export const pcaBiplotModule: VizModule<PcaParams> = {
  roles: [
    { key: 'vars', label: '변수 (숫자형)', type: 'number', required: true, multiple: { min: 2, max: 10 } },
    { key: 'group', label: '그룹 (색, 선택)', type: 'category', auto: true },
  ],
  datasets: ['pca-students', 'flowers', 'cars', 'nutrition'],
  defaultParams: { center: true, scale: true, pcX: 1, pcY: 2, points: true, arrows: true, labels: true, arrowScaling: 'loadings', arrowGain: 1, size: 4, hidden: [] },
  Chart: PcaChart,
  Controls: PcaControls,
  hint: '점은 관측값, 화살표는 변수의 방향 · 비슷한 방향의 화살표는 함께 변하는 변수 · 범례로 그룹 숨기기',
}
