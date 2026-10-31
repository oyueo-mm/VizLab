import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime, type DataTable } from '../../data/table'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { formatISO } from '../../stats/datetime'
import { cumulativeFlow, lexisTable, psth, spiralPoint, type Lifeline } from '../../stats/special'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { paddedDomain } from './shared'

/** Special-purpose charts: pictogram, Nightingale rose, radial bar, event raster, barcode timeline, Lexis diagram, cumulative flow and spiral time plot. */

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

function catValue(table: DataTable, mapping: Mapping) {
  const ci = columnIndex(table, roleColumn(mapping, 'cat')), vi = columnIndex(table, roleColumn(mapping, 'value')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const by = new Map<string, number>()
  const stack = new Map<string, Map<string, number>>()
  const groups: string[] = []
  if (ci < 0 || vi < 0) return { items: [] as { key: string; value: number; parts: { g: string; v: number }[] }[], groups }
  for (const r of table.rows) {
    const k = toLabel(r[ci]), v = toNumber(r[vi])
    if (!k || v == null || v < 0) continue
    by.set(k, (by.get(k) ?? 0) + v)
    if (gi >= 0) { const g = toLabel(r[gi]); if (!groups.includes(g)) groups.push(g); const m = stack.get(k) ?? new Map(); m.set(g, (m.get(g) ?? 0) + v); stack.set(k, m) }
  }
  return { items: [...by].map(([key, value]) => ({ key, value, parts: gi >= 0 ? groups.map((g) => ({ g, v: stack.get(key)?.get(g) ?? 0 })) : [{ g: '', v: value }] })), groups }
}

const catRoles = (withGroup = false): RoleSpec[] => [
  { key: 'cat', label: '범주', type: 'category', required: true },
  ...(withGroup ? [{ key: 'group', label: '하위 구분 (선택, 쌓기)', type: 'category' as const, auto: true }] : []),
  { key: 'value', label: '값', type: 'number', required: true },
]

// ─── pictogram ──────────────────────────────────────────────────────────────────────

export interface PictoParams { unit: number; icon: 'person' | 'circle' | 'square' | 'star' | 'drop'; perRow: number; sort: boolean }

const ICON_PATH: Record<string, string> = {
  star: 'M0,-1 L0.29,-0.4 L0.95,-0.31 L0.47,0.15 L0.59,0.81 L0,0.5 L-0.59,0.81 L-0.47,0.15 L-0.95,-0.31 L-0.29,-0.4Z',
  drop: 'M0,-1 C0.25,-0.5 0.8,-0.1 0.8,0.35 A0.8,0.8 0 0 1 -0.8,0.35 C-0.8,-0.1 -0.25,-0.5 0,-1Z',
}

function Icon({ kind, size, fill, frac = 1, clip }: { kind: PictoParams['icon']; size: number; fill: string; frac?: number; clip: string }) {
  const s = size / 2
  const shape = (f: string, op: number) => {
    if (kind === 'circle') return <circle r={s * 0.9} fill={f} fillOpacity={op} />
    if (kind === 'square') return <rect x={-s * 0.85} y={-s * 0.85} width={s * 1.7} height={s * 1.7} rx={s * 0.15} fill={f} fillOpacity={op} />
    if (kind === 'person') return <g fill={f} fillOpacity={op}><circle cy={-s * 0.55} r={s * 0.36} /><path d={`M${-s * 0.62},${s * 0.95}V${s * 0.05}A${s * 0.62},${s * 0.5} 0 0 1 ${s * 0.62},${s * 0.05}V${s * 0.95}Z`} /></g>
    return <path d={ICON_PATH[kind]} transform={`scale(${s})`} fill={f} fillOpacity={op} />
  }
  return (
    <g>
      {shape('#d9e1de', 1)}
      {frac > 0 && <><clipPath id={clip}><rect x={-s} y={-s} width={2 * s * Math.min(1, frac)} height={2 * s} /></clipPath><g clipPath={`url(#${clip})`}>{shape(fill, 1)}</g></>}
    </g>
  )
}

let pid = 0

function PictoChart({ table, mapping, params, width, height, compact }: ChartProps<PictoParams>) {
  const { items } = useMemo(() => catValue(table, mapping), [table, mapping])
  const sorted = useMemo(() => (params.sort ? [...items].sort((a, b) => b.value - a.value) : items), [items, params.sort])
  const color = categoryColor(sorted.map((i) => i.key))
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const base = useMemo(() => `pic${++pid}`, [])
  if (!roleColumn(mapping, 'cat') || !roleColumn(mapping, 'value')) return <ChartMessage>범주(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!sorted.length) return <ChartMessage>0 이상의 값이 있는 범주가 없습니다.</ChartMessage>
  const unit = Math.max(1e-9, params.unit)
  const labelW = compact ? 0 : Math.min(120, width * 0.22)
  const rows = sorted.length
  const rowH = Math.min(70, (height - 36) / rows)
  const cell = Math.max(6, Math.min(rowH * 0.9, (width - labelW - 24) / params.perRow))
  const perRowEff = Math.max(1, Math.min(params.perRow, Math.floor((width - labelW - 24) / cell)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`픽토그램 차트: 아이콘 하나 = ${fmt(unit)}`} onPointerLeave={hide}>
        <g transform={`translate(${labelW},12)`}>
          {sorted.map((it, ri) => {
            const full = Math.floor(it.value / unit + 1e-9), rem = it.value / unit - full
            const total = full + (rem > 0.02 ? 1 : 0)
            return (
              <g key={it.key} data-testid="picto-row" data-value={it.value} transform={`translate(0,${ri * rowH})`} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{it.key}</b><br />{fmt(it.value)} = 아이콘 {fmt(it.value / unit, 2)}개</>) }} onPointerLeave={hide}>
                {!compact && <text x={-8} y={rowH / 2} dy="0.32em" textAnchor="end" fontSize={12.5} fill="#111827">{it.key.length > 9 ? `${it.key.slice(0, 8)}…` : it.key}</text>}
                {Array.from({ length: total }, (_, k) => <g key={k} data-testid="picto-icon" transform={`translate(${(k % perRowEff) * cell + cell / 2},${Math.floor(k / perRowEff) * (cell * 0.95) + cell / 2})`}><Icon kind={params.icon} size={cell * 0.84} fill={color(it.key)} frac={k < full ? 1 : rem} clip={`${base}-${ri}-${k}`} /></g>)}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <><p className="chart-note" role="note" style={{ left: 'auto', right: 8, bottom: 8 }}>아이콘 1개 = {fmt(unit)}</p><Readout items={[{ label: '범주', value: sorted.length }, { label: '아이콘', value: Math.round(d3.sum(sorted, (i) => i.value) / unit) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function PictoControls({ params, setParams, table, mapping }: ControlsProps<PictoParams>) {
  const { items } = useMemo(() => catValue(table, mapping), [table, mapping])
  const vmax = Math.max(1, ...items.map((i) => i.value))
  return (
    <ControlGroup title="픽토그램">
      <NumberField label="아이콘 1개가 나타내는 값" value={params.unit} min={0.001} step={Math.max(0.5, Math.round(vmax / 40))} onChange={(unit) => setParams({ unit })} testId="ctl-picto-unit" />
      <Select label="아이콘" value={params.icon} onChange={(icon) => setParams({ icon })} testId="ctl-picto-icon" options={[{ value: 'person', label: '사람' }, { value: 'circle', label: '원' }, { value: 'square', label: '사각형' }, { value: 'star', label: '별' }, { value: 'drop', label: '물방울' }]} />
      <Slider label="한 줄의 아이콘 수" value={params.perRow} min={3} max={30} onChange={(perRow) => setParams({ perRow })} testId="ctl-picto-perrow" />
      <Toggle label="큰 값부터 정렬" checked={params.sort} onChange={(sort) => setParams({ sort })} />
      <Hint>값을 같은 크기의 아이콘 개수로 바꿔 세어 볼 수 있게 한 차트입니다. 크기가 아니라 개수로 양을 전달하기 때문에 막대보다 비전문가에게 친숙하고, 소수점 아래는 아이콘을 비율만큼만 채워 나타냅니다. 아이콘 크기를 범주마다 다르게 하지 않는 것이 핵심이며(크기를 키우면 면적이 과장됨), 아이콘 1개가 얼마인지를 꼭 밝혀야 합니다. 값 차이가 매우 크면 아이콘이 너무 많아지므로 단위를 키우세요.</Hint>
    </ControlGroup>
  )
}

export const pictogramModule: VizModule<PictoParams> = {
  roles: catRoles(),
  datasets: ['votes', 'categorical'],
  defaultParams: { unit: 5, icon: 'person', perRow: 12, sort: true },
  Chart: PictoChart,
  Controls: PictoControls,
  hint: '아이콘 1개가 나타내는 값을 바꿔 보세요 · 소수 부분은 아이콘을 일부만 채웁니다 · 아이콘 모양과 줄당 개수 선택',
}

// ─── Nightingale rose ───────────────────────────────────────────────────────────────

export interface RoseChartParams { scale: 'area' | 'radius'; scheme: ColorScheme; gap: number; labels: boolean; inner: number }

function NightingaleChart({ table, mapping, params, width, height, compact }: ChartProps<RoseChartParams>) {
  const { items, groups } = useMemo(() => catValue(table, mapping), [table, mapping])
  const stacked = groups.length > 0
  const color = categoryColor(stacked ? groups : items.map((i) => i.key))
  const scheme = schemes[params.scheme]
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'cat') || !roleColumn(mapping, 'value')) return <ChartMessage>범주(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>0 이상의 값이 있는 범주가 없습니다.</ChartMessage>
  const R = Math.max(40, Math.min(width, height) / 2 - (compact ? 10 : 40))
  const r0 = R * params.inner
  const n = items.length, w = (2 * Math.PI) / n
  const vmax = Math.max(...items.map((i) => i.value)) || 1
  // area encoding: r² grows linearly with the value (r = √(r0² + (R²−r0²)·v/vmax)); radius encoding: r grows linearly
  const rOf = (v: number) => (params.scale === 'area' ? Math.sqrt(r0 * r0 + (R * R - r0 * r0) * (v / vmax)) : r0 + (R - r0) * (v / vmax))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`나이팅게일 로즈 차트: 범주 ${n}개, ${params.scale === 'area' ? '면적' : '반지름'} 비례`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {[0.25, 0.5, 0.75, 1].map((f) => <circle key={f} r={rOf(vmax * f)} fill="none" stroke="#e1e6e4" strokeWidth={0.9} />)}
          {items.map((it, i) => {
            let acc = 0
            return it.parts.map((p, k) => {
              const a0 = i * w + params.gap * 0.01, a1 = (i + 1) * w - params.gap * 0.01
              const lo = rOf(acc), hi = rOf(acc + p.v)
              acc += p.v
              if (p.v <= 0) return null
              const fill = stacked ? color(p.g) : scheme.interpolate(0.2 + 0.7 * (i / Math.max(1, n - 1)))
              return <path key={`${i}-${k}`} data-testid="rose-slice" data-value={p.v} d={d3.arc()({ innerRadius: lo, outerRadius: hi, startAngle: a0, endAngle: a1 }) ?? ''} fill={fill} stroke="#fff" strokeWidth={0.8}
                onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{it.key}</b>{stacked ? ` · ${p.g}` : ''}<br />값 {fmt(p.v)}{stacked ? ` (범주 합계 ${fmt(it.value)})` : ''}</>) }} onPointerLeave={hide} />
            })
          })}
          {!compact && params.labels && items.map((it, i) => { const a = (i + 0.5) * w; const rr = R + 16; return <text key={it.key} x={rr * Math.sin(a)} y={-rr * Math.cos(a) + 4} textAnchor="middle" fontSize={11.5} fill="#374151">{it.key.length > 6 ? `${it.key.slice(0, 5)}…` : it.key}</text> })}
        </g>
      </svg>
      {!compact && <><Legend items={stacked ? groups.map((g) => ({ key: g, color: color(g) })) : []} /><Readout items={[{ label: '범주', value: n }, { label: '최댓값', value: fmt(vmax) }, { label: '눈금', value: params.scale === 'area' ? '면적 ∝ 값' : '반지름 ∝ 값' }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function NightingaleControls({ params, setParams }: ControlsProps<RoseChartParams>) {
  return (
    <ControlGroup title="나이팅게일 로즈">
      <Segmented label="값을 나타내는 방식" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-rose-scale" options={[{ value: 'area', label: '면적 비례 (정직)' }, { value: 'radius', label: '반지름 비례 (과장)' }]} />
      <Slider label="가운데 비움" value={params.inner} min={0} max={0.5} step={0.02} onChange={(inner) => setParams({ inner })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-rose-inner" />
      <Slider label="부채꼴 사이 간격" value={params.gap} min={0} max={20} onChange={(gap) => setParams({ gap })} />
      <Select label="팔레트 (하위 구분이 없을 때)" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Toggle label="범주 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>나이팅게일 로즈 차트는 각 범주를 같은 각도의 부채꼴로 놓고 값을 부채꼴의 반지름으로 나타내는 극좌표 막대입니다. 면적은 반지름의 제곱에 비례하므로 반지름을 값에 비례시키면 차이가 제곱으로 과장됩니다 — 정직하게 읽으려면 면적이 값에 비례하도록 반지름을 제곱근으로 줄여야 합니다(기본값). 하위 구분이 있으면 안쪽부터 쌓습니다. 정확한 비교에는 막대그래프가 낫습니다.</Hint>
    </ControlGroup>
  )
}

export const nightingaleModule: VizModule<RoseChartParams> = {
  roles: catRoles(true),
  datasets: ['categorical', 'votes'],
  defaultParams: { scale: 'area', scheme: 'ylorrd', gap: 4, labels: true, inner: 0.06 },
  Chart: NightingaleChart,
  Controls: NightingaleControls,
  hint: '면적 비례와 반지름 비례를 번갈아 보세요(반지름 비례는 차이를 과장) · 하위 구분은 안쪽부터 쌓입니다 · 부채꼴에 포인터를 올리면 값',
}

// ─── radial bar ─────────────────────────────────────────────────────────────────────

export interface RadialBarParams { sweep: number; inner: number; sort: boolean; scheme: ColorScheme; labels: boolean }

function RadialBarChart({ table, mapping, params, width, height, compact }: ChartProps<RadialBarParams>) {
  const { items } = useMemo(() => catValue(table, mapping), [table, mapping])
  const sorted = useMemo(() => (params.sort ? [...items].sort((a, b) => b.value - a.value) : items), [items, params.sort])
  const scheme = schemes[params.scheme]
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'cat') || !roleColumn(mapping, 'value')) return <ChartMessage>범주(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!sorted.length) return <ChartMessage>0 이상의 값이 있는 범주가 없습니다.</ChartMessage>
  const R = Math.max(50, Math.min(width, height) / 2 - (compact ? 8 : 20))
  const r0 = R * params.inner
  const bw = (R - r0) / sorted.length
  const vmax = Math.max(...sorted.map((i) => i.value)) || 1
  const sweep = (params.sweep * Math.PI) / 180
  const a = d3.scaleLinear().domain([0, vmax]).range([0, sweep])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`방사형 막대그래프: 범주 ${sorted.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {sorted.map((_, i) => <circle key={`t${i}`} r={r0 + (i + 0.5) * bw} fill="none" stroke="#eef1f0" strokeWidth={bw * 0.78} />)}
          {sorted.map((it, i) => (
            <g key={it.key}>
              <path data-testid="radial-bar" data-value={it.value} d={d3.arc()({ innerRadius: r0 + i * bw + bw * 0.11, outerRadius: r0 + (i + 1) * bw - bw * 0.11, startAngle: 0, endAngle: a(it.value), cornerRadius: Math.min(4, bw / 4) } as never) ?? ''} fill={scheme.interpolate(0.2 + 0.7 * (1 - i / Math.max(1, sorted.length - 1)))}
                onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{it.key}</b><br />값 {fmt(it.value)} ({pct(it.value / vmax, 0)} of 최댓값)<br />호의 길이로 값을 읽습니다 (바깥 고리일수록 같은 각도라도 더 긴 호)</>) }} onPointerLeave={hide} />
              {!compact && params.labels && <text x={-6} y={-(r0 + (i + 0.5) * bw) + 4} textAnchor="end" fontSize={Math.min(11.5, bw * 0.8)} fill="#111827">{it.key.length > 8 ? `${it.key.slice(0, 7)}…` : it.key}</text>}
            </g>
          ))}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '범주', value: sorted.length }, { label: '최댓값', value: fmt(vmax) }, { label: '최대 각', value: `${params.sweep}°` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function RadialBarControls({ params, setParams }: ControlsProps<RadialBarParams>) {
  return (
    <ControlGroup title="방사형 막대">
      <Slider label="최대 값의 각도" value={params.sweep} min={90} max={360} step={15} onChange={(sweep) => setParams({ sweep })} format={(v) => `${v}°`} testId="ctl-radial-sweep" />
      <Slider label="가운데 비움" value={params.inner} min={0.1} max={0.6} step={0.02} onChange={(inner) => setParams({ inner })} format={(v) => `${Math.round(v * 100)}%`} />
      <Toggle label="큰 값부터 정렬" checked={params.sort} onChange={(sort) => setParams({ sort })} />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Toggle label="범주 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>방사형 막대그래프는 범주마다 동심원 고리 하나를 주고 값을 호의 각도(길이)로 나타냅니다. 같은 값이라도 바깥 고리일수록 호가 길어 보여 비교가 왜곡됩니다(안쪽 고리는 짧은 호로 보임). 따라서 정렬해서 가장 큰 값이 가장 안쪽에 오게 하거나, 정확한 비교에는 직선 막대를 쓰세요. 각도 범위를 360°가 아닌 270° 정도로 두면 눈금 읽기가 쉽습니다.</Hint>
    </ControlGroup>
  )
}

export const radialBarModule: VizModule<RadialBarParams> = {
  roles: catRoles(),
  datasets: ['votes', 'categorical'],
  defaultParams: { sweep: 270, inner: 0.22, sort: true, scheme: 'teal', labels: true },
  Chart: RadialBarChart,
  Controls: RadialBarControls,
  hint: '최대 각도를 바꿔 보세요 · 같은 값도 바깥 고리일수록 호가 길어 보이는 왜곡에 주의 · 호에 포인터를 올리면 값',
}

// ─── event raster ───────────────────────────────────────────────────────────────────

export interface RasterParams { bin: number; psth: boolean; sort: 'data' | 'first' | 'count'; align: number; hidden: string[] }

function EventRasterChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<RasterParams>) {
  const ti = columnIndex(table, roleColumn(mapping, 'trial')), xi = columnIndex(table, roleColumn(mapping, 'time')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const data = useMemo(() => {
    const ev: { trial: string; t: number; g: string; row: number }[] = []
    if (ti < 0 || xi < 0) return ev
    table.rows.forEach((r, row) => { const t = toNumber(r[xi]); if (t != null) ev.push({ trial: toLabel(r[ti]), t: t - params.align, g: gi >= 0 ? toLabel(r[gi]) : '', row }) })
    return ev
  }, [table, ti, xi, gi, params.align])
  const groups = useMemo(() => [...new Set(data.map((e) => e.g))].filter(Boolean), [data])
  const color = categoryColor(groups)
  const trials = useMemo(() => {
    const by = new Map<string, { id: string; g: string; ts: number[] }>()
    for (const e of data) { const t = by.get(e.trial) ?? { id: e.trial, g: e.g, ts: [] }; t.ts.push(e.t); by.set(e.trial, t) }
    let list = [...by.values()].filter((t) => !params.hidden.includes(t.g))
    if (params.sort === 'first') list.sort((a, b) => Math.min(...a.ts) - Math.min(...b.ts))
    else if (params.sort === 'count') list.sort((a, b) => b.ts.length - a.ts.length)
    if (groups.length) list = [...groups].flatMap((g) => list.filter((t) => t.g === g))
    return list
  }, [data, params.sort, params.hidden, groups])
  const lo = d3.min(data, (e) => e.t) ?? 0, hi = d3.max(data, (e) => e.t) ?? 1
  const hist = useMemo(() => (params.psth ? groups.length ? groups.filter((g) => !params.hidden.includes(g)).map((g) => ({ g, bins: psth(data.filter((e) => e.g === g), trials.filter((t) => t.g === g).length, lo, hi, params.bin) })) : [{ g: '', bins: psth(data, trials.length, lo, hi, params.bin) }] : []), [params.psth, params.bin, data, trials, groups, params.hidden, lo, hi])
  const showHist = params.psth && !compact
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right)
  const histH = showHist ? Math.min(120, (height - m.top - m.bottom) * 0.28) : 0
  const gap = showHist ? 22 : 0
  const rasterH = Math.max(40, height - m.top - m.bottom - histH - gap)
  const x = d3.scaleLinear().domain([lo, hi]).range([0, iw])
  const rowH = rasterH / Math.max(1, trials.length)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'trial') || !roleColumn(mapping, 'time')) return <ChartMessage>시행(범주형)과 사건 시각(숫자형) 열을 선택하세요.</ChartMessage>
  if (!data.length) return <ChartMessage>숫자로 읽을 수 있는 사건 시각이 없습니다.</ChartMessage>
  const hmax = d3.max(hist.flatMap((h) => h.bins), (b) => b.rate) ?? 1
  const yh = d3.scaleLinear().domain([0, hmax * 1.1]).range([histH, 0])
  const tickH = Math.max(1.5, Math.min(rowH * 0.8, 14))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`이벤트 래스터: 시행 ${trials.length}개, 사건 ${data.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {showHist && (
            <g data-testid="psth">
              <AxisLeft scale={yh} x={0} grid={iw} label="발생률 (사건/시행/단위시간)" ticks={3} />
              {hist.map((h) => h.bins.map((b, i) => <rect key={`${h.g}${i}`} data-testid="psth-bin" x={x(b.x0) + 0.5} y={yh(b.rate)} width={Math.max(0.5, x(b.x1) - x(b.x0) - 1)} height={Math.max(0, histH - yh(b.rate))} fill={h.g ? color(h.g) : '#2a7d74'} fillOpacity={groups.length ? 0.45 : 0.8} onPointerEnter={(e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{fmt(b.x0, 0)}–{fmt(b.x1, 0)}</b>{h.g ? ` · ${h.g}` : ''}<br />{b.count}개 · 발생률 {fmt(b.rate, 3)}</>) }} onPointerLeave={hide} />))}
            </g>
          )}
          <g transform={`translate(0,${histH + gap})`}>
            <AxisBottom scale={x} y={rasterH} grid={rasterH} label="시각 (0 = 정렬 기준)" compact={compact} />
            <line x1={x(0)} x2={x(0)} y1={0} y2={rasterH} stroke="#e07a3f" strokeDasharray="4 3" />
            {trials.map((t, ri) => <g key={t.id} data-testid="raster-row" data-trial={t.id}>{t.ts.map((tt, k) => <line key={k} x1={x(tt)} x2={x(tt)} y1={ri * rowH + (rowH - tickH) / 2} y2={ri * rowH + (rowH + tickH) / 2} stroke={t.g ? color(t.g) : '#2a7d74'} strokeWidth={1.1} />)}</g>)}
            {!compact && trials.map((t, ri) => <rect key={`h${t.id}`} x={0} y={ri * rowH} width={iw} height={rowH} fill="transparent" onPointerEnter={(e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>시행 {t.id}</b>{t.g ? ` · ${t.g}` : ''}<br />사건 {t.ts.length}개</>) }} onPointerLeave={hide} />)}
          </g>
        </g>
      </svg>
      {!compact && <><Legend items={groups.map((g) => ({ key: g, color: color(g) }))} hidden={params.hidden} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} /><Readout items={[{ label: '시행', value: trials.length }, { label: '사건', value: data.length }, { label: '시행당 평균', value: fmt(data.length / Math.max(1, trials.length), 1) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function EventRasterControls({ params, setParams }: ControlsProps<RasterParams>) {
  return (
    <ControlGroup title="래스터와 히스토그램">
      <Toggle label="PSTH (발생률 히스토그램)" checked={params.psth} onChange={(psth) => setParams({ psth })} testId="ctl-raster-psth" />
      <Slider label="히스토그램 구간 폭" value={params.bin} min={5} max={100} step={5} onChange={(bin) => setParams({ bin })} testId="ctl-raster-bin" />
      <Select label="시행 정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-raster-sort" options={[{ value: 'data', label: '표의 순서' }, { value: 'first', label: '첫 사건이 빠른 순' }, { value: 'count', label: '사건이 많은 순' }]} />
      <NumberField label="정렬 기준 시각 (0으로 둘 시각)" value={params.align} step={10} onChange={(align) => setParams({ align })} />
      <Hint>이벤트 래스터는 시행마다 한 줄을 주고 사건이 일어난 시각에 짧은 선을 찍습니다. 위쪽 히스토그램(PSTH)은 시행에 걸쳐 시간 구간별 사건 수를 평균해 발생률로 보여 주어, 개별 시행의 들쭉날쭉함 속에서 자극 뒤에 반응이 늘어나는 것 같은 경향을 드러냅니다. 구간 폭이 좁으면 거칠고 넓으면 시간 해상도가 사라집니다. 시행을 정렬하면 반응의 지연이 패턴으로 보이지만 인과를 보장하지는 않습니다. 예제는 합성 사건입니다.</Hint>
    </ControlGroup>
  )
}

export const eventRasterModule: VizModule<RasterParams> = {
  roles: [{ key: 'trial', label: '시행', type: 'category', required: true, prefer: '시행|trial' }, { key: 'time', label: '사건 시각', type: 'number', required: true, prefer: '시각|time' }, { key: 'group', label: '조건 (선택)', type: 'category', auto: true, prefer: '조건|group' }],
  datasets: ['spike-trials'],
  defaultParams: { bin: 20, psth: true, sort: 'data', align: 0, hidden: [] },
  Chart: EventRasterChart,
  Controls: EventRasterControls,
  hint: '구간 폭을 바꿔 발생률 히스토그램이 어떻게 달라지는지 보세요 · 범례로 조건 숨기기 · 시행 정렬로 반응 지연 패턴 확인',
}

// ─── barcode timeline ───────────────────────────────────────────────────────────────

export interface BarcodeParams { alpha: number; thickness: number; hidden: string[]; density: boolean }

function BarcodeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<BarcodeParams>) {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const date = ti >= 0 && table.columns[ti].type === 'date'
  const ev = useMemo(() => { const out: { t: number; g: string; row: number }[] = []; if (ti < 0) return out; table.rows.forEach((r, row) => { const t = date ? toTime(r[ti] as never) : toNumber(r[ti]); if (t != null) out.push({ t, g: gi >= 0 ? toLabel(r[gi]) || '(빈 값)' : '전체', row }) }); return out }, [table, ti, gi, date])
  const groups = useMemo(() => [...new Set(ev.map((e) => e.g))], [ev])
  const color = categoryColor(groups)
  const shown = groups.filter((g) => !params.hidden.includes(g))
  const m = margins(compact, compact ? {} : { left: 90 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const [t0, t1] = d3.extent(ev, (e) => e.t) as [number, number]
  const x = d3.scaleLinear().domain(paddedDomain([t0 ?? 0, t1 ?? 1], 0.01)).range([0, iw])
  const rowH = ih / Math.max(1, shown.length)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'time')) return <ChartMessage>시각(날짜형 또는 숫자형) 열을 선택하세요.</ChartMessage>
  if (!ev.length) return <ChartMessage>읽을 수 있는 사건 시각이 없습니다.</ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`바코드 타임라인: 사건 ${ev.length}개, 그룹 ${shown.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="시각" compact={compact} date={date} />
          {shown.map((g, gi2) => {
            const list = ev.filter((e) => e.g === g)
            return (
              <g key={g} transform={`translate(0,${gi2 * rowH})`} data-testid="barcode-row" data-group={g} data-count={list.length}>
                <rect x={0} y={rowH * 0.1} width={iw} height={rowH * 0.8} fill="#f6f8f7" />
                {!compact && <text x={-8} y={rowH / 2} dy="0.32em" textAnchor="end" fontSize={12} fill="#111827">{g.length > 10 ? `${g.slice(0, 9)}…` : g}</text>}
                {list.map((e) => <line key={e.row} data-testid="barcode-line" x1={x(e.t)} x2={x(e.t)} y1={rowH * 0.12} y2={rowH * 0.88} stroke={color(g)} strokeOpacity={params.alpha} strokeWidth={params.thickness}
                  onPointerEnter={compact ? undefined : (pe) => { const l = localPoint(svgRef.current!, pe); show(l.x, l.y, <><b>{g}</b><br />{date ? formatISO(e.t, true) : fmt(e.t)}</>) }} onPointerLeave={hide} />)}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <><Legend items={groups.map((g) => ({ key: `${g} (${ev.filter((e) => e.g === g).length})`, color: color(g) }))} hidden={params.hidden.map((h) => `${h} (${ev.filter((e) => e.g === h).length})`)} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k.replace(/ \(\d+\)$/, '')) })} /><Readout items={[{ label: '사건', value: ev.length }, { label: '그룹', value: groups.length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function BarcodeControls({ params, setParams }: ControlsProps<BarcodeParams>) {
  return (
    <ControlGroup title="바코드 타임라인">
      <Slider label="선 불투명도" value={params.alpha} min={0.1} max={1} step={0.05} onChange={(alpha) => setParams({ alpha })} format={(v) => v.toFixed(2)} testId="ctl-barcode-alpha" />
      <Slider label="선 굵기" value={params.thickness} min={0.5} max={4} step={0.25} onChange={(thickness) => setParams({ thickness })} />
      <Hint>바코드 타임라인은 사건 하나를 가는 세로선 하나로 시간축 위에 찍습니다. 점이나 막대로 묶지 않아 모든 사건의 정확한 시각이 보이고, 선이 빽빽한 곳은 사건이 몰린 시기(급증, 장애)입니다. 선이 겹쳐 아주 많아지면 불투명도를 낮춰 밀도를 읽으세요. 사건이 수만 개이면 히스토그램이 낫습니다. 예제는 합성 이벤트입니다.</Hint>
    </ControlGroup>
  )
}

export const barcodeModule: VizModule<BarcodeParams> = {
  roles: [{ key: 'group', label: '그룹 (선택, 행)', type: 'category', auto: true, prefer: '유형|group' }, { key: 'time', label: '사건 시각', type: 'date', accept: ['date', 'number'], required: true, prefer: '시각|time' }],
  datasets: ['event-log'],
  defaultParams: { alpha: 0.6, thickness: 1, hidden: [], density: false },
  Chart: BarcodeChart,
  Controls: BarcodeControls,
  hint: '선이 빽빽한 곳이 사건이 몰린 시기입니다 · 불투명도를 낮춰 밀도를 읽으세요 · 범례로 그룹 숨기기 · 선에 포인터를 올리면 시각',
}

// ─── Lexis diagram ──────────────────────────────────────────────────────────────────

export interface LexisParams { width: number; showRates: boolean; showLines: boolean; selected: number; scheme: ColorScheme }

function LexisChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LexisParams>) {
  const si = columnIndex(table, roleColumn(mapping, 'start')), ei = columnIndex(table, roleColumn(mapping, 'end')), vi = columnIndex(table, roleColumn(mapping, 'event'))
  const lines: Lifeline[] = useMemo(() => { const out: Lifeline[] = []; if (si < 0 || ei < 0) return out; table.rows.forEach((r, row) => { const s = toNumber(r[si]), e = toNumber(r[ei]), v = vi >= 0 ? toNumber(r[vi]) : 1; if (s != null && e != null && e > s) out.push({ id: out.length, start: s, end: e, event: v === 1, row }) }); return out }, [table, si, ei, vi])
  const cells = useMemo(() => lexisTable(lines, params.width), [lines, params.width])
  const scheme = schemes[params.scheme]
  const m = margins(compact)
  const side = Math.max(60, Math.min(width - m.left - m.right, height - m.top - m.bottom))
  const t0 = Math.floor((d3.min(lines, (l) => l.start) ?? 0) / params.width) * params.width, t1 = Math.ceil((d3.max(lines, (l) => l.end) ?? 1) / params.width) * params.width
  const aMax = Math.ceil((d3.max(lines, (l) => l.end - l.start) ?? 1) / params.width) * params.width
  const iw = Math.min(width - m.left - m.right, side * ((t1 - t0) / Math.max(1, aMax))), ih = Math.min(height - m.top - m.bottom, iw * (aMax / Math.max(1, t1 - t0)))
  const x = d3.scaleLinear().domain([t0, t1]).range([0, iw]), y = d3.scaleLinear().domain([0, aMax]).range([ih, 0])
  const rate = (c: (typeof cells)[number]) => (c.exposure > 0 ? c.events / c.exposure : 0)
  const rmax = d3.max(cells, rate) || 1
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'start') || !roleColumn(mapping, 'end')) return <ChartMessage>시작과 종료 시점(숫자형, 연도) 열을 선택하세요.</ChartMessage>
  if (!lines.length) return <ChartMessage>종료가 시작보다 큰 생명선이 없습니다.</ChartMessage>
  const sel = params.selected >= 0 ? lines.find((l) => l.id === params.selected) : null
  const grid = d3.range(t0, t1 + 1e-9, params.width)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`렉시스 도표: 생명선 ${lines.length}개, 사건 ${lines.filter((l) => l.event).length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} label="달력 시간 (연도)" format={(v) => String(Math.round(v))} compact={compact} />
          <AxisLeft scale={y} x={0} label="나이" compact={compact} />
          {params.showRates && cells.map((c, i) => <rect key={i} data-testid="lexis-cell" data-exposure={c.exposure.toFixed(3)} data-events={c.events} x={x(c.period)} y={y(c.age + params.width)} width={Math.max(0, x(c.period + params.width) - x(c.period))} height={Math.max(0, y(c.age) - y(c.age + params.width))} fill={c.exposure > 0 ? scheme.interpolate(0.1 + 0.85 * (rate(c) / rmax)) : '#fff'} fillOpacity={0.75} stroke="#fff" strokeWidth={0.6}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{c.period}–{c.period + params.width}년, 나이 {c.age}–{c.age + params.width}</b><br />관찰 {fmt(c.exposure, 1)}인년 · 사건 {c.events}건<br />발생률 {fmt(rate(c) * 1000, 1)}‰ (인년당)</>) }} onPointerLeave={hide} />)}
          {grid.map((v) => <g key={v} stroke="#cfd6d3" strokeWidth={0.8} pointerEvents="none"><line x1={x(v)} x2={x(v)} y1={0} y2={ih} />{v - t0 <= aMax && <line x1={0} x2={iw} y1={y(v - t0)} y2={y(v - t0)} />}<line x1={x(v)} y1={y(0)} x2={x(Math.min(t1, v + aMax))} y2={y(Math.min(aMax, t1 - v))} strokeDasharray="2 3" strokeOpacity={0.7} /></g>)}
          {params.showLines && lines.map((l) => {
            const x0 = x(l.start), y0 = y(0), x1 = x(Math.min(l.end, t1)), y1 = y(Math.min(l.end - l.start, aMax))
            const on = params.selected === l.id
            return <g key={l.id} data-testid="lifeline" data-id={l.id} style={{ cursor: compact ? 'default' : 'pointer' }} onClick={compact ? undefined : () => setParams({ selected: on ? -1 : l.id })}
              onPointerEnter={compact ? undefined : (e) => { const q = localPoint(svgRef.current!, e); show(q.x, q.y, <><b>생명선 {l.id + 1}</b><br />{fmt(l.start, 1)}년 시작 → {fmt(l.end, 1)}년 {l.event ? '사건 발생' : '관찰 종료'}<br />출생 코호트 {Math.floor(l.start)}년 · {fmt(l.end - l.start, 1)}년 관찰</>) }} onPointerLeave={hide}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={on ? '#e07a3f' : '#374151'} strokeWidth={on ? 2.6 : 1} strokeOpacity={on ? 1 : 0.55} />
              {l.event ? <circle cx={x1} cy={y1} r={compact ? 1.8 : 3.2} fill="#c0453a" /> : <circle cx={x1} cy={y1} r={compact ? 1.8 : 3} fill="#fff" stroke="#374151" strokeWidth={1} />}
            </g>
          })}
          {sel && !compact && <text x={x(sel.start) + 6} y={y(0) - 6} fontSize={11} fill="#a8531f" stroke="#fff" strokeWidth={3} paintOrder="stroke">코호트 {Math.floor(sel.start)}</text>}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '생명선', value: lines.length }, { label: '사건', value: lines.filter((l) => l.event).length }, { label: '인년', value: fmt(d3.sum(lines, (l) => l.end - l.start), 0) }, { label: '칸 크기', value: `${params.width}년` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function LexisControls({ params, setParams }: ControlsProps<LexisParams>) {
  return (
    <ControlGroup title="렉시스 도표">
      <Slider label="달력·나이 칸 크기 (년)" value={params.width} min={1} max={10} onChange={(w) => setParams({ width: w })} testId="ctl-lexis-width" />
      <Toggle label="칸별 발생률 색" checked={params.showRates} onChange={(showRates) => setParams({ showRates })} testId="ctl-lexis-rates" />
      <Toggle label="생명선 (45° 선)" checked={params.showLines} onChange={(showLines) => setParams({ showLines })} />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Hint>렉시스 도표는 가로축을 달력 시간, 세로축을 나이로 놓습니다. 한 사람은 태어난(가입한) 시점에서 나이 0으로 출발해 1년에 한 칸씩 오르는 45° 선(생명선)이고, 선이 끝나는 점은 사건 발생(●) 또는 관찰 종료(○)입니다. 세로 칸은 같은 시기(기간), 가로 칸은 같은 나이, 대각 띠는 같은 출생 코호트입니다. 칸마다 관찰 인년과 사건 수를 세어 나이–기간 발생률을 구하며, 나이·기간·코호트 효과는 서로 선형 종속이라 분리하기 어렵다는 점이 유명한 한계입니다. 생명선을 눌러 한 사람(코호트)을 강조합니다. 예제는 합성입니다.</Hint>
    </ControlGroup>
  )
}

export const lexisModule: VizModule<LexisParams> = {
  roles: [{ key: 'start', label: '시작 (가입·출생 연도)', type: 'number', required: true, prefer: '시작|start' }, { key: 'end', label: '종료 (연도)', type: 'number', required: true, prefer: '종료|end' }, { key: 'event', label: '사건 (1/0, 선택)', type: 'number', prefer: '사건|event' }],
  datasets: ['lifelines'],
  defaultParams: { width: 5, showRates: true, showLines: true, selected: -1, scheme: 'ylorrd' },
  Chart: LexisChart,
  Controls: LexisControls,
  hint: '45° 선이 한 사람의 삶 · 세로 칸은 같은 시기, 가로 칸은 같은 나이, 대각 띠는 같은 코호트 · 칸 크기를 바꿔 발생률의 안정성 확인',
}

// ─── cumulative flow diagram ────────────────────────────────────────────────────────

export interface CfdParams { scheme: ColorScheme; smooth: boolean; wip: boolean; from: number }

function CfdChart({ table, mapping, params, width, height, compact }: ChartProps<CfdParams>) {
  const di = columnIndex(table, roleColumn(mapping, 'date')), si = columnIndex(table, roleColumn(mapping, 'stage')), ni = columnIndex(table, roleColumn(mapping, 'count'))
  const { stages, flow } = useMemo(() => {
    const rows: { t: number; stage: string; n: number }[] = []
    if (di >= 0 && si >= 0 && ni >= 0) for (const r of table.rows) { const t = toTime(r[di]), n = toNumber(r[ni]); if (t != null && n != null && n >= 0) rows.push({ t, stage: toLabel(r[si]), n }) }
    const st = [...new Set(rows.map((r) => r.stage))]
    return { stages: st, flow: cumulativeFlow(rows.map((r) => ({ t: r.t, stage: st.indexOf(r.stage), n: r.n })), st.length) }
  }, [table, di, si, ni])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'date') || !roleColumn(mapping, 'stage') || !roleColumn(mapping, 'count')) return <ChartMessage>날짜, 단계(범주형), 건수(숫자형) 열을 선택하세요.</ChartMessage>
  if (flow.length < 3 || stages.length < 2) return <ChartMessage>날짜 3개 이상, 단계 2개 이상이 필요합니다.</ChartMessage>
  const scheme = schemes[params.scheme]
  const x = d3.scaleLinear().domain([flow[0].t, flow[flow.length - 1].t]).range([0, iw])
  const ymax = d3.max(flow, (p) => p.cum[0]) ?? 1
  const y = d3.scaleLinear().domain([0, ymax * 1.03]).range([ih, 0])
  const curve = params.smooth ? d3.curveMonotoneX : d3.curveStepAfter
  const band = (k: number) => d3.area<(typeof flow)[number]>().x((p) => x(p.t)).y0((p) => y(k + 1 < stages.length ? p.cum[k + 1] : 0)).y1((p) => y(p.cum[k])).curve(curve)(flow) ?? ''
  const last = flow[flow.length - 1]
  const done = stages.length - 1
  const win = flow.filter((p) => p.t >= last.t - 14 * 86400000)
  const throughput = win.length > 1 ? (win[win.length - 1].cum[done] - win[0].cum[done]) / ((win[win.length - 1].t - win[0].t) / 86400000) : NaN
  const wipNow = last.cum[0] - last.cum[done]
  const leadTime = throughput > 0 ? wipNow / throughput : NaN
  const hover = (e: React.PointerEvent) => { const l = localPoint(svgRef.current!, e); if (l.x < m.left || l.x > m.left + iw) { hide(); return } const t = x.invert(l.x - m.left); const i = d3.bisector((p: { t: number }) => p.t).center(flow, t); const p = flow[i]; show(l.x, l.y, <><b>{formatISO(p.t)}</b>{stages.map((s, k) => <span key={s}><br />{s}: 누적 {fmt(p.cum[k], 0)}{k + 1 < stages.length ? ` (단계 안 ${fmt(p.cum[k] - p.cum[k + 1], 0)}건)` : ''}</span>)}</>) }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`누적 흐름 다이어그램: 단계 ${stages.length}개, 현재 진행 중 ${fmt(wipNow, 0)}건`} onPointerMove={compact ? undefined : hover} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="날짜" compact={compact} date />
          <AxisLeft scale={y} x={0} grid={iw} label="누적 건수" compact={compact} />
          {stages.slice(0, -1).map((s, k) => <path key={s} data-testid="cfd-band" data-stage={s} d={band(k)} fill={scheme.interpolate(0.15 + 0.7 * (1 - k / Math.max(1, stages.length - 2)))} fillOpacity={0.85} stroke="#fff" strokeWidth={0.6} />)}
          {stages.map((s, k) => <path key={`l${s}`} d={d3.line<(typeof flow)[number]>().x((p) => x(p.t)).y((p) => y(p.cum[k])).curve(curve)(flow) ?? ''} fill="none" stroke="#374151" strokeWidth={1.1} pointerEvents="none" />)}
          {!compact && stages.map((s, k) => <text key={`t${s}`} x={iw + 4} y={y(last.cum[k]) + 3} fontSize={11} fill="#374151">{s}</text>)}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '진행 중 (WIP)', value: `${fmt(wipNow, 0)}건` }, { label: '처리량 (최근 14일)', value: Number.isFinite(throughput) ? `${fmt(throughput, 2)}건/일` : '–' }, { label: '예상 리드타임 (WIP÷처리량)', value: Number.isFinite(leadTime) ? `${fmt(leadTime, 1)}일` : '–' }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function CfdControls({ params, setParams }: ControlsProps<CfdParams>) {
  return (
    <ControlGroup title="누적 흐름">
      <Toggle label="부드럽게 (곡선)" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Hint>누적 흐름 다이어그램은 단계마다 ‘그 단계에 도달한 누적 건수’를 쌓아 그린 영역입니다. 두 경계선 사이의 세로 두께가 그 단계에 머무는 작업량(WIP), 가로 거리가 대략 그 단계의 소요 시간입니다. 띠가 점점 두꺼워지면 병목(그 단계에 일이 쌓임), 선이 평행하면 흐름이 안정적입니다. 리틀의 법칙에 따라 평균 리드타임 ≈ WIP ÷ 처리량으로 추정합니다. 누적량이라 선이 내려가지 않으며(작업이 되돌아가면 별도 처리가 필요), 예제는 합성 작업 흐름입니다.</Hint>
    </ControlGroup>
  )
}

export const cfdModule: VizModule<CfdParams> = {
  roles: [{ key: 'date', label: '날짜', type: 'date', required: true, prefer: '날짜|date' }, { key: 'stage', label: '단계 (순서대로)', type: 'category', required: true, prefer: '단계|stage' }, { key: 'count', label: '그날 그 단계에 들어온 건수', type: 'number', required: true, prefer: '건수|count' }],
  datasets: ['kanban'],
  defaultParams: { scheme: 'teal', smooth: false, wip: true, from: 0 },
  Chart: CfdChart,
  Controls: CfdControls,
  hint: '띠가 두꺼워지는 단계가 병목입니다 · 두께는 진행 중 작업량(WIP) · 포인터로 날짜별 단계 건수 확인 · 처리량과 리드타임 추정',
}

// ─── spiral time plot ───────────────────────────────────────────────────────────────

export interface SpiralParams { period: 'week' | 'month' | 'year' | 'custom'; custom: number; scheme: ColorScheme; thick: boolean; start: number }

function SpiralChart({ table, mapping, params, width, height, compact }: ChartProps<SpiralParams>) {
  const di = columnIndex(table, roleColumn(mapping, 'date')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const date = di >= 0 && table.columns[di].type === 'date'
  const pts = useMemo(() => { const out: { t: number; v: number; row: number }[] = []; if (di < 0 || vi < 0) return out; table.rows.forEach((r, row) => { const t = date ? toTime(r[di] as never) : toNumber(r[di]), v = toNumber(r[vi]); if (t != null && v != null) out.push({ t, v, row }) }); return out.sort((a, b) => a.t - b.t) }, [table, di, vi, date])
  const unit = date ? 86400000 : 1
  const period = (params.period === 'week' ? 7 : params.period === 'month' ? 30.4375 : params.period === 'year' ? 365.25 : params.custom) * unit
  const scheme = schemes[params.scheme]
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'date') || !roleColumn(mapping, 'value')) return <ChartMessage>시간(날짜형 또는 숫자형)과 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (pts.length < 4) return <ChartMessage>유효한 (시간, 값) 행이 4개 이상 필요합니다.</ChartMessage>
  const t0 = pts[0].t
  const turns = (pts[pts.length - 1].t - t0) / period
  const R = Math.max(50, Math.min(width, height) / 2 - (compact ? 8 : 34))
  const inner = R * 0.14
  const pitch = (R - inner - 6) / Math.max(1, turns)
  const [lo, hi] = d3.extent(pts, (p) => p.v) as [number, number]
  const sp = (t: number) => spiralPoint(t, t0, period, inner, pitch, (params.start * Math.PI) / 180)
  const xy = (p: { angle: number; r: number }): [number, number] => [p.r * Math.sin(p.angle), -p.r * Math.cos(p.angle)]
  const th = (v: number) => (params.thick ? 1.2 + (pitch * 0.92 - 1.2) * ((v - lo) / (hi - lo || 1)) : Math.max(2, pitch * 0.5))
  const labels = params.period === 'year' ? ['1월', '4월', '7월', '10월'] : params.period === 'week' ? ['월', '수', '금', '일'] : params.period === 'month' ? ['1일', '8일', '15일', '22일'] : ['0', '¼', '½', '¾']
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`나선형 시계열: ${turns.toFixed(1)}바퀴, 주기 ${params.period}`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {[0, 90, 180, 270].map((d) => <line key={d} x1={0} y1={0} x2={(R + 4) * Math.sin((d * Math.PI) / 180)} y2={-(R + 4) * Math.cos((d * Math.PI) / 180)} stroke="#e6ebe9" />)}
          {pts.map((p, i) => {
            const a = sp(p.t), b = i + 1 < pts.length ? sp(pts[i + 1].t) : sp(p.t + (p.t - (pts[i - 1]?.t ?? p.t - period / 30)))
            const [x1, y1] = xy(a), [x2, y2] = xy(b)
            if (Math.abs(b.turns - a.turns) > 0.5) return null
            return <line key={i} data-testid="spiral-seg" data-row={p.row} x1={x1} y1={y1} x2={x2} y2={y2} stroke={scheme.interpolate(0.12 + 0.86 * ((p.v - lo) / (hi - lo || 1)))} strokeWidth={th(p.v)} strokeLinecap="butt"
              onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{date ? formatISO(p.t) : fmt(p.t)}</b><br />값 {fmt(p.v)}<br />{a.turns.toFixed(1)}번째 바퀴</>) }} onPointerLeave={hide} />
          })}
          {!compact && labels.map((l, i) => <text key={l} x={(R + 16) * Math.sin(((params.start + i * 90) * Math.PI) / 180)} y={-(R + 16) * Math.cos(((params.start + i * 90) * Math.PI) / 180) + 4} textAnchor="middle" fontSize={12} fill="#374151">{l}</text>)}
        </g>
      </svg>
      {!compact && <><div className="color-legend"><span>{fmt(lo)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(0.12 + 0.86 * v)).join(',')})` }} /><span>{fmt(hi)}</span></div><Readout items={[{ label: '주기', value: params.period === 'custom' ? `${params.custom}` : { week: '1주', month: '1개월', year: '1년' }[params.period] }, { label: '바퀴', value: turns.toFixed(1) }, { label: '점', value: pts.length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function SpiralControls({ params, setParams }: ControlsProps<SpiralParams>) {
  return (
    <ControlGroup title="나선형 시계열">
      <Select label="한 바퀴의 주기" value={params.period} onChange={(period) => setParams({ period })} testId="ctl-spiral-period" options={[{ value: 'week', label: '1주 (7일)' }, { value: 'month', label: '1개월 (30.4일)' }, { value: 'year', label: '1년 (365.25일)' }, { value: 'custom', label: '직접 지정' }]} />
      {params.period === 'custom' && <NumberField label="주기 (일 또는 표본 수)" value={params.custom} min={2} step={1} onChange={(custom) => setParams({ custom })} testId="ctl-spiral-custom" />}
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Toggle label="값을 선 굵기로도 표현" checked={params.thick} onChange={(thick) => setParams({ thick })} />
      <Slider label="시작 각도" value={params.start} min={0} max={345} step={15} onChange={(start) => setParams({ start })} format={(v) => `${v}°`} />
      <Hint>시간 순서대로 점을 나선에 놓되 한 바퀴를 주기 하나로 정해, 같은 위상(같은 요일, 같은 계절)이 같은 방향에 쌓이게 합니다. 주기성이 있으면 같은 방향에 비슷한 색이 줄지어 방사선 무늬가 생기고, 주기를 잘못 고르면 무늬가 소용돌이처럼 휩니다. 주기를 바꿔 보며 가장 선명하게 정렬되는 주기를 찾을 수 있습니다. 바깥쪽이 최근이며 바깥 바퀴일수록 원둘레가 길어 같은 구간이 더 길게 그려지는 점은 감안해야 합니다.</Hint>
    </ControlGroup>
  )
}

export const spiralModule: VizModule<SpiralParams> = {
  roles: [{ key: 'date', label: '시간', type: 'date', accept: ['date', 'number'], required: true, prefer: '날짜|date|시점' }, { key: 'value', label: '값', type: 'number', required: true, prefer: '걸음|값|value' }],
  datasets: ['daily', 'visits-dated'],
  defaultParams: { period: 'week', custom: 24, scheme: 'viridis', thick: true, start: 0 },
  Chart: SpiralChart,
  Controls: SpiralControls,
  hint: '주기를 바꿔 방사선 무늬가 가장 선명해지는 값을 찾아보세요(1주, 1개월, 1년) · 바깥쪽이 최근 · 선에 포인터를 올리면 날짜와 값',
}

