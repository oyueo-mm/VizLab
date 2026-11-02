import * as d3 from 'd3'
import { percentileRanker, vsupBins, vsupCell, vsupColor } from '../../stats/vsup'
import { useMemo } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useSvgId } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { MapZoomButtons } from '../../geo/useMapZoom'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { classBreaks, classIndex, classMethods, type ClassMethod } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { GeoControls, HatchDefs, geoDefaults, resolveMap, type GeoParams } from './geoShared'
import { correlation, regionRows, useRegionStage } from './regionKit'

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))
const regionRole = { key: 'region', label: '지역 ID (예: KOR, KR-11)', type: 'category' as const, required: true, prefer: 'ID|코드|code' }

// ─── bivariate choropleth ───────────────────────────────────────────────────────────

export interface BivariateParams extends GeoParams { classes: 2 | 3 | 4; method: ClassMethod; palette: 'stevens' | 'warm' | 'green'; borders: boolean; cell: string; selected: string; /** v0.9: 'vsup' reads Y as uncertainty and merges the value colours as it rises */ scheme?: 'grid' | 'vsup' }

const PALETTES: Record<BivariateParams['palette'], { name: string; c00: string; c10: string; c01: string; c11: string }> = {
  stevens: { name: '청록 × 보라', c00: '#e8e8e8', c10: '#5ac8c8', c01: '#be64ac', c11: '#3b4994' },
  warm: { name: '파랑 × 주황', c00: '#e8e8e8', c10: '#6baed6', c01: '#f0a25c', c11: '#7a3b22' },
  green: { name: '초록 × 붉은색', c00: '#eeeeee', c10: '#7fbf7b', c01: '#e8808a', c11: '#5b3a6b' },
}

/** Colour of class cell (i for x, j for y) of an n×n scheme: bilinear blend of the four corner colours in Lab space. */
export function bivariateColor(pal: BivariateParams['palette'], n: number, i: number, j: number): string {
  const p = PALETTES[pal]
  const tx = n === 1 ? 0 : i / (n - 1), ty = n === 1 ? 0 : j / (n - 1)
  const bottom = d3.interpolateLab(p.c00, p.c10)(tx)
  const top = d3.interpolateLab(p.c01, p.c11)(tx)
  return d3.interpolateLab(bottom, top)(ty)
}

/** Colour ramp of the value axis used by the VSUP scheme: the palette's own corner colours, light to dark. */
const vsupRamp = (pal: BivariateParams['palette']) => { const p = PALETTES[pal]; const a = d3.interpolateLab(p.c00, p.c10), b = d3.interpolateLab(p.c10, p.c11); return (t: number) => (t < 0.5 ? a(2 * t) : b(2 * t - 1)) }

function BivariateChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<BivariateParams>) {
  const st = useRegionStage(table, mapping, params, width, height, compact, KEYS_XY)
  const { data, map, paths, svgRef, zoom, tip, show, hide } = st
  const n = params.classes
  const rows = useMemo(() => map.regions.map((r) => { const d = data.get(r.id); const x = d?.values.x ?? null, y = d?.values.y ?? null; return { r, d, x, y } }), [map, data])
  const xs = rows.map((q) => q.x).filter((v): v is number => v != null), ys = rows.map((q) => q.y).filter((v): v is number => v != null)
  const ex = useMemo(() => classBreaks(xs, params.method, n), [xs.join(','), params.method, n]) // eslint-disable-line react-hooks/exhaustive-deps
  const ey = useMemo(() => classBreaks(ys, params.method, n), [ys.join(','), params.method, n]) // eslint-disable-line react-hooks/exhaustive-deps
  const cx = Math.max(1, ex.length - 1), cy = Math.max(1, ey.length - 1)
  const vsup = params.scheme === 'vsup'
  const rankX = useMemo(() => percentileRanker(xs), [xs.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const rankY = useMemo(() => percentileRanker(ys), [ys.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const cls = rows.map((q) => {
    if (q.x == null || q.y == null) return null
    if (vsup) { const v = vsupCell(rankX(q.x), rankY(q.y), n); return { i: v.bin, j: v.level } }
    return { i: Math.min(cx - 1, classIndex(q.x, ex)), j: Math.min(cy - 1, classIndex(q.y, ey)) }
  })
  const ramp = vsupRamp(params.palette)
  const colorOf = (c: { i: number; j: number }) => (vsup ? vsupColor(ramp, { level: c.j, bin: c.i, bins: vsupBins(n, c.j) }, n) : bivariateColor(params.palette, Math.max(cx, cy), c.i, c.j))
  const marked = new Set(linked?.rows ?? [])
  const hatch = useSvgId('biv-hatch')
  const r = useMemo(() => correlation(rows.filter((q) => q.x != null && q.y != null).map((q) => q.x!), rows.filter((q) => q.x != null && q.y != null).map((q) => q.y!)), [rows])
  const counts = useMemo(() => { const m = new Map<string, number>(); cls.forEach((c) => { if (c) m.set(`${c.i},${c.j}`, (m.get(`${c.i},${c.j}`) ?? 0) + 1) }); return m }, [cls])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'x') || !roleColumn(mapping, 'y')) return <ChartMessage>지역 ID(범주형)와 값 두 개(숫자형) 열을 선택하세요.</ChartMessage>
  if (!xs.length || !ys.length) return <ChartMessage>지도와 맞는 지역 ID에 두 값이 모두 있는 지역이 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>
  const G = compact ? 0 : Math.min(120, height * 0.2)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`이변량 코로플레스: ${n}×${n} 범례, 상관계수 ${fmt(r, 2)}`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><HatchDefs id={hatch} /></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {paths.map(({ r: reg, d }, idx) => {
            const c = cls[idx]
            const row = rows[idx]
            const hi = params.cell === (c ? `${c.i},${c.j}` : '') || params.selected === reg.id || (row.d?.rows.some((q) => marked.has(q)) ?? false)
            const dim = params.cell !== '' && !hi
            return (
              <path key={reg.id} className="map-region" data-testid="map-region" data-id={reg.id} data-cell={c ? `${c.i},${c.j}` : ''} d={d} fill={c ? colorOf(c) : `url(#${hatch})`} fillOpacity={dim ? 0.25 : 1}
                stroke={hi ? '#121816' : '#ffffff'} strokeWidth={hi ? 1.6 : params.borders ? 0.6 : 0} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (e) => { linked?.set(row.d?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{reg.name}</b><br />{roleColumn(mapping, 'x')}: {fmt(row.x)}{c ? ` (구간 ${c.i + 1}/${cx})` : ''}<br />{roleColumn(mapping, 'y')}: {fmt(row.y)}{c ? ` (구간 ${c.j + 1}/${cy})` : ''}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === reg.id ? '' : reg.id })} />
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <svg className="bivariate-legend" width={G + 78} height={G + 40} style={{ position: 'absolute', left: 8, bottom: 8 }} role="group" aria-label="이변량 범례" data-testid="biv-legend">
          <g transform={`translate(22,${4})`}>
            {vsup
              ? Array.from({ length: n }, (_, lv) => Array.from({ length: vsupBins(n, lv) }, (_, bi) => {
                const bins = vsupBins(n, lv), cw = G / bins, ch = G / n
                const key = `${bi},${lv}`
                return <rect key={key} data-testid="biv-cell" data-count={counts.get(key) ?? 0} x={bi * cw} y={(n - 1 - lv) * ch} width={cw - 1} height={ch - 1} fill={vsupColor(ramp, { level: lv, bin: bi, bins }, n)} stroke={params.cell === key ? '#121816' : 'none'} strokeWidth={2} style={{ cursor: 'pointer' }}
                  onClick={() => setParams({ cell: params.cell === key ? '' : key })}><title>{`불확실성 단계 ${lv + 1} · 값 구간 ${bi + 1}/${bins}: ${counts.get(key) ?? 0}개 지역`}</title></rect>
              }))
              : Array.from({ length: cy }, (_, jj) => Array.from({ length: cx }, (_, ii) => {
              const cw = G / Math.max(cx, cy)
              const key = `${ii},${jj}`
              return <rect key={key} data-testid="biv-cell" data-count={counts.get(key) ?? 0} x={ii * cw} y={(cy - 1 - jj) * cw} width={cw - 1} height={cw - 1} fill={bivariateColor(params.palette, Math.max(cx, cy), ii, jj)} stroke={params.cell === key ? '#121816' : 'none'} strokeWidth={2} style={{ cursor: 'pointer' }}
                onClick={() => setParams({ cell: params.cell === key ? '' : key })}><title>{`${roleColumn(mapping, 'x')} 구간 ${ii + 1} · ${roleColumn(mapping, 'y')} 구간 ${jj + 1}: ${counts.get(key) ?? 0}개 지역`}</title></rect>
            }))}
            <text x={G / 2} y={G + 14} textAnchor="middle" className="bar-label">{roleColumn(mapping, 'x')} →</text>
            <text transform={`translate(-8,${G / 2}) rotate(-90)`} textAnchor="middle" className="bar-label">{roleColumn(mapping, 'y')}{vsup ? ' (불확실성) →' : ' →'}</text>
          </g>
        </svg>
        <Readout items={[{ label: '지역', value: cls.filter(Boolean).length }, { label: '상관 r', value: fmt(r, 2) }, ...(params.cell ? [{ label: '선택 칸', value: `${counts.get(params.cell) ?? 0}개 지역` }] : [])]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

const KEYS_XY = ['x', 'y']

function BivariateControls({ params, setParams, table, mapping }: ControlsProps<BivariateParams>) {
  const st = useMemo(() => regionRows(table, mapping, KEYS_XY), [table, mapping])
  const resolved = useRegionResolved(params, st)
  const method = classMethods.find((m) => m.value === params.method)
  return (
    <>
      <ControlGroup title="구간 나누기">
        <Segmented label="팔레트 방식" value={params.scheme ?? 'grid'} onChange={(scheme) => setParams({ scheme })} testId="ctl-biv-scheme" options={[{ value: 'grid', label: '이변량 격자' }, { value: 'vsup', label: 'VSUP (불확실성 억제)' }]} />
        {params.scheme === 'vsup' && <Hint>VSUP는 Y를 불확실성으로 읽습니다. 불확실성이 낮은 단계에서는 X의 값 구간을 잘게(2ⁿ⁻¹개) 나누고, 불확실성이 높아질수록 인접한 구간을 둘씩 합쳐 마지막 단계에서는 한 색이 되어, 불확실한 값끼리는 색으로 구별되지 않습니다. 구간은 분위 순위로 나눕니다. ‘격자 크기’는 불확실성 단계 수입니다. 원 논문의 트리 구성(색 평균·채도 억제 규칙)을 단순화해, 합친 구간의 가운데 값 색에 불확실성만큼 회색을 섞습니다.</Hint>}
        <Segmented label="격자 크기" value={String(params.classes)} onChange={(v) => setParams({ classes: Number(v) as 2 | 3 | 4 })} testId="ctl-biv-classes" options={[{ value: '2', label: '2×2' }, { value: '3', label: '3×3' }, { value: '4', label: '4×4' }]} />
        <Select label="분할 기준 (두 변수 각각)" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-biv-method" options={classMethods.map((m) => ({ value: m.value, label: m.label }))} />
        {method && <Hint>{method.hint}</Hint>}
        <Select label="색 조합" value={params.palette} onChange={(palette) => setParams({ palette })} options={(Object.keys(PALETTES) as BivariateParams['palette'][]).map((k) => ({ value: k, label: PALETTES[k].name }))} />
        <Toggle label="지역 경계선" checked={params.borders} onChange={(borders) => setParams({ borders })} />
        <Hint>두 변수를 각각 구간으로 나눈 조합마다 하나의 색을 씁니다. 왼쪽 아래(회색)는 둘 다 낮고, 오른쪽 위(진한 색)는 둘 다 높은 지역입니다. 범례 칸을 누르면 그 조합의 지역만 강조됩니다. 구간 경계는 변수마다 따로 정하므로 두 변수의 단위는 달라도 됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

function useRegionResolved(params: GeoParams, data: Map<string, unknown>) { return useMemo(() => resolveMap(params, [...data.keys()]), [params, data]) }

export const bivariateModule: VizModule<BivariateParams> = {
  roles: [regionRole, { key: 'x', label: '변수 X (가로 구간)', type: 'number', required: true, prefer: '고령|aging|인구|population' }, { key: 'y', label: '변수 Y (세로 구간)', type: 'number', required: true, prefer: '소득|income|GDP' }],
  datasets: ['kr-indicators', 'world-regions'],
  defaultParams: { ...geoDefaults, classes: 3, method: 'quantile', palette: 'stevens', borders: true, cell: '', selected: '' },
  Chart: BivariateChart,
  Controls: BivariateControls,
  hint: '범례의 칸을 눌러 그 조합의 지역만 강조 · 구간 수와 분할 기준을 바꿔 두 변수의 관계가 어떻게 보이는지 확인',
}

// ─── chorochromatic (qualitative regions) ───────────────────────────────────────────

export interface ChoroParams extends GeoParams { borders: boolean; hidden: string[]; selected: string; labels: boolean }

function ChorochromaticChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<ChoroParams>) {
  const st = useRegionStage(table, mapping, params, width, height, compact, NONE, 'cls')
  const { data, map, paths, svgRef, zoom, tip, show, hide } = st
  const cats = useMemo(() => [...new Set([...data.values()].map((d) => d.text).filter(Boolean))], [data])
  const color = useMemo(() => categoryColor(cats), [cats])
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const [id, d] of data) if (map.byId.has(id) && d.text) m.set(d.text, (m.get(d.text) ?? 0) + 1); return m }, [data, map])
  const hatch = useSvgId('chor-cat-hatch')
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'cls')) return <ChartMessage>지역 ID와 범주(범주형) 열을 선택하세요.</ChartMessage>
  if (!cats.length) return <ChartMessage>지도와 맞는 지역 ID에 범주가 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`질적 구역도: 범주 ${cats.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><HatchDefs id={hatch} /></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {paths.map(({ r, d }) => {
            const e = data.get(r.id)
            const off = !!e?.text && params.hidden.includes(e.text)
            const on = params.selected === r.id || (e?.rows.some((q) => marked.has(q)) ?? false)
            return (
              <path key={r.id} className="map-region" data-testid="map-region" data-id={r.id} data-cat={e?.text ?? ''} d={d} fill={!e?.text ? `url(#${hatch})` : off ? '#f1f4f3' : color(e.text)} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 1.8 : params.borders ? 0.6 : 0} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (ev) => { linked?.set(e?.rows ?? null); const p = localPoint(svgRef.current!, ev); show(p.x, p.y, <><b>{r.name}</b> <small>{r.id}</small><br />{e?.text ? `범주: ${e.text}` : '범주 없음'}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === r.id ? '' : r.id })} />
            )
          })}
          {params.labels && !compact && k >= 1.5 && map.regions.map((r) => { const xy = st.projection(r.centroid); return xy && data.get(r.id)?.text ? <text key={r.id} className="net-label" x={xy[0]} y={xy[1]} fontSize={10 / k} textAnchor="middle" pointerEvents="none">{r.name}</text> : null })}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={cats.map((c) => ({ key: c, color: color(c) }))} hidden={params.hidden} onToggle={(c) => setParams({ hidden: params.hidden.includes(c) ? params.hidden.filter((x) => x !== c) : [...params.hidden, c] })} title={roleColumn(mapping, 'cls') ?? ''} />
        <Readout items={[{ label: '범주', value: cats.length }, { label: '지역', value: [...counts.values()].reduce((a, b) => a + b, 0) }, ...(params.selected && map.byId.get(params.selected) ? [{ label: '선택', value: `${map.byId.get(params.selected)!.name} · ${data.get(params.selected)?.text ?? '–'}` }] : [])]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

const NONE: string[] = []
const SIZE_KEY = ['size']

function ChorochromaticControls({ params, setParams, table, mapping }: ControlsProps<ChoroParams>) {
  const data = useMemo(() => regionRows(table, mapping, NONE, 'cls'), [table, mapping])
  const resolved = useRegionResolved(params, data)
  return (
    <>
      <ControlGroup title="범주 색칠">
        <Toggle label="지역 경계선" checked={params.borders} onChange={(borders) => setParams({ borders })} />
        <Toggle label="지역 이름 (확대 시)" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Hint>범주는 순서나 크기가 없는 이름(권역, 대륙, 토지 이용 등)이므로 서로 구별되는 색을 씁니다. 색의 진하기가 값의 크기로 읽히지 않도록 명도가 비슷한 색을 고릅니다. 범례를 눌러 범주를 숨기면 나머지가 도드라집니다. 범주가 8개를 넘으면 색을 구별하기 어렵습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const chorochromaticModule: VizModule<ChoroParams> = {
  roles: [regionRole, { key: 'cls', label: '범주 (색)', type: 'category', required: true, prefer: '권역|대륙|구분|class|group' }],
  datasets: ['kr-indicators', 'world-continents'],
  defaultParams: { ...geoDefaults, borders: true, hidden: [], selected: '', labels: true },
  Chart: ChorochromaticChart,
  Controls: ChorochromaticControls,
  hint: '범례를 눌러 범주를 숨기거나 보이기 · 지역을 눌러 선택 · 확대하면 지역 이름이 나타납니다',
}

// ─── value-by-alpha ─────────────────────────────────────────────────────────────────

export interface VbaParams extends GeoParams { scheme: ColorScheme; classes: number; minAlpha: number; invert: boolean; borders: boolean; selected: string }
const KEYS_VA = ['value', 'alpha']

function VbaChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<VbaParams>) {
  const st = useRegionStage(table, mapping, params, width, height, compact, KEYS_VA)
  const { data, map, paths, svgRef, zoom, tip, show, hide } = st
  const rows = useMemo(() => map.regions.map((r) => { const d = data.get(r.id); return { r, d, v: d?.values.value ?? null, a: d?.values.alpha ?? null } }), [map, data])
  const vs = rows.map((q) => q.v).filter((v): v is number => v != null), as = rows.map((q) => q.a).filter((v): v is number => v != null)
  const [vlo, vhi] = d3.extent(vs) as [number, number], [alo, ahi] = d3.extent(as) as [number, number]
  const edges = useMemo(() => classBreaks(vs, 'quantile', params.classes), [vs.join(','), params.classes]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheme = schemes[params.scheme]
  const nCls = Math.max(1, edges.length - 1)
  const colorOf = (v: number) => scheme.interpolate(0.15 + 0.85 * (nCls === 1 ? 0.5 : classIndex(v, edges) / (nCls - 1)))
  // opacity: the reliability (or any second variable) scaled to [minAlpha, 1]; with ‘invert’ a larger second value is more transparent (e.g. a margin of error)
  const alphaOf = (a: number | null) => { if (a == null) return 1; const t = ahi === alo ? 1 : (a - alo) / (ahi - alo); return params.minAlpha + (1 - params.minAlpha) * (params.invert ? 1 - t : t) }
  const hatch = useSvgId('vba-hatch')
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value') || !roleColumn(mapping, 'alpha')) return <ChartMessage>지역 ID(범주형), 값, 투명도로 쓸 두 번째 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!vs.length) return <ChartMessage>지도와 맞는 지역 ID에 값이 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>
  const L = 5
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`Value-by-Alpha 지도: 색은 ${roleColumn(mapping, 'value')}, 투명도는 ${roleColumn(mapping, 'alpha')}`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><HatchDefs id={hatch} /></defs>
        <rect x={-5000} y={-5000} width={10000} height={10000} fill="#ffffff" />
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {paths.map(({ r, d }, i) => {
            const q = rows[i]
            const on = params.selected === r.id || (q.d?.rows.some((x) => marked.has(x)) ?? false)
            return (
              <path key={r.id} className="map-region" data-testid="map-region" data-id={r.id} data-alpha={q.v == null ? '' : alphaOf(q.a).toFixed(3)} d={d} fill={q.v == null ? `url(#${hatch})` : colorOf(q.v)} fillOpacity={q.v == null ? 1 : alphaOf(q.a)}
                stroke={on ? '#121816' : '#c9d1ce'} strokeWidth={on ? 1.8 : params.borders ? 0.6 : 0} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (e) => { linked?.set(q.d?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{r.name}</b><br />{roleColumn(mapping, 'value')}: {fmt(q.v)}<br />{roleColumn(mapping, 'alpha')}: {fmt(q.a)} → 불투명도 {Math.round(alphaOf(q.a) * 100)}%</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === r.id ? '' : r.id })} />
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <svg className="bivariate-legend" width={150} height={118} style={{ position: 'absolute', left: 8, bottom: 8 }} role="group" aria-label="값·투명도 범례" data-testid="vba-legend">
          <g transform="translate(22,4)">
            {Array.from({ length: L }, (_, jj) => Array.from({ length: nCls }, (_, ii) => {
              const cw = 100 / Math.max(nCls, L)
              const t = jj / (L - 1)
              return <rect key={`${ii},${jj}`} x={ii * cw} y={(L - 1 - jj) * cw} width={cw - 1} height={cw - 1} fill={scheme.interpolate(0.15 + 0.85 * (nCls === 1 ? 0.5 : ii / (nCls - 1)))} fillOpacity={params.minAlpha + (1 - params.minAlpha) * t} />
            }))}
            <text x={50} y={113} textAnchor="middle" className="bar-label">{roleColumn(mapping, 'value')} →</text>
            <text transform="translate(-8,50) rotate(-90)" textAnchor="middle" className="bar-label">{params.invert ? '오차 큼 ← → 작음' : '신뢰도 →'}</text>
          </g>
        </svg>
        <Readout items={[{ label: '값', value: `${fmt(vlo)} – ${fmt(vhi)}` }, { label: '투명도 변수', value: `${fmt(alo)} – ${fmt(ahi)}` }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function VbaControls({ params, setParams, table, mapping }: ControlsProps<VbaParams>) {
  const data = useMemo(() => regionRows(table, mapping, KEYS_VA), [table, mapping])
  const resolved = useRegionResolved(params, data)
  return (
    <>
      <ControlGroup title="색과 투명도">
        <Select label="색상 팔레트 (값)" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
        <Slider label="값 계급 수 (분위수)" value={params.classes} min={2} max={7} onChange={(classes) => setParams({ classes })} testId="ctl-vba-classes" />
        <Slider label="가장 흐린 불투명도" value={params.minAlpha} min={0.05} max={0.7} step={0.05} onChange={(minAlpha) => setParams({ minAlpha })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-vba-min" />
        <Toggle label="큰 값일수록 더 투명 (오차·불확실성)" checked={params.invert} onChange={(invert) => setParams({ invert })} testId="ctl-vba-invert" />
        <Toggle label="지역 경계선" checked={params.borders} onChange={(borders) => setParams({ borders })} />
        <Hint>색은 주제 값을, 불투명도는 그 값을 얼마나 믿을 수 있는지(표본 수, 신뢰도)를 나타냅니다. 흐릿한 지역은 눈에 덜 띄어 믿기 어려운 값에 시선이 덜 가게 됩니다. 불투명도 변수가 오차나 불확실성이면 ‘큰 값일수록 더 투명’을 켭니다. 두 변수가 서로 섞여 읽히는 점이 단점이므로 범례를 함께 보세요.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const vbaModule: VizModule<VbaParams> = {
  roles: [regionRole, { key: 'value', label: '값 (색)', type: 'number', required: true, prefer: '소득|income|값|value' }, { key: 'alpha', label: '신뢰도·불확실성 (투명도)', type: 'number', required: true, prefer: '신뢰도|표본|reliab|오차' }],
  datasets: ['kr-indicators'],
  defaultParams: { ...geoDefaults, scheme: 'teal', classes: 5, minAlpha: 0.2, invert: false, borders: true, selected: '' },
  Chart: VbaChart,
  Controls: VbaControls,
  hint: '신뢰도가 낮은 지역이 흐리게 보입니다 · 최소 불투명도와 반전을 바꿔 보세요 · 범례의 두 축을 함께 읽습니다',
}

// ─── chart glyph map ────────────────────────────────────────────────────────────────

export interface GlyphParams extends GeoParams { glyph: 'pie' | 'donut' | 'bars'; maxSize: number; sizeMode: 'total' | 'fixed'; showMap: boolean; labels: boolean; selected: string }

function GlyphChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<GlyphParams>) {
  const parts = useMemo(() => { const v = mapping.parts; return Array.isArray(v) ? v : [] }, [mapping])
  const st = useRegionStage(table, mapping, params, width, height, compact, SIZE_KEY, undefined, true, parts)
  const { data, map, paths, svgRef, zoom, tip, show, hide, projection } = st
  const color = useMemo(() => categoryColor(parts), [parts])
  const items = useMemo(() => map.regions.flatMap((r) => {
    const d = data.get(r.id)
    if (!d) return []
    const vals = parts.map((p) => Math.max(0, d.values[p] ?? 0))
    const total = d3.sum(vals)
    const xy = projection(r.centroid)
    return total > 0 && xy ? [{ r, d, vals, total, size: d.values.size, xy }] : []
  }), [map, data, parts, projection])
  const sizeMax = d3.max(items, (it) => (params.sizeMode === 'total' ? it.size ?? it.total : 1)) ?? 1
  const R = (compact ? 0.5 : 1) * params.maxSize
  const radius = (it: (typeof items)[number]) => (params.sizeMode === 'fixed' ? R * 0.6 : Math.max(5, R * Math.sqrt((it.size ?? it.total) / sizeMax)))
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || parts.length < 2) return <ChartMessage>지역 ID(범주형)와 구성 요소 열(숫자형) 2개 이상을 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>지도와 맞는 지역 ID에 구성 값이 없습니다.</ChartMessage>
  const arcs = d3.pie<number>().sort(null)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`지도 위 차트: ${items.length}개 지역에 ${params.glyph === 'bars' ? '막대' : params.glyph === 'pie' ? '파이' : '도넛'} 차트`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && paths.map(({ r, d }) => <path key={r.id} className="map-base" d={d} fill="#f1f4f3" stroke="#d5dbd9" strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {items.map((it) => {
            const rr = radius(it) / k
            const on = params.selected === it.r.id || it.d.rows.some((q) => marked.has(q))
            const tipFn = compact ? undefined : (e: React.PointerEvent) => { linked?.set(it.d.rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{it.r.name}</b>{it.size != null ? <> · {roleColumn(mapping, 'size')} {fmt(it.size, 0)}</> : null}<br />{parts.map((pn, i) => <span key={pn}>{pn} {fmt(it.vals[i])} ({Math.round((it.vals[i] / it.total) * 100)}%)<br /></span>)}</>) }
            return (
              <g key={it.r.id} data-testid="glyph" data-id={it.r.id} transform={`translate(${it.xy[0]},${it.xy[1]})`} onPointerMove={tipFn} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === it.r.id ? '' : it.r.id })}>
                {params.glyph === 'bars' ? (
                  <g>
                    <rect x={-rr} y={-rr} width={2 * rr} height={2 * rr} fill="#fff" fillOpacity={0.85} stroke={on ? '#121816' : '#c9d1ce'} strokeWidth={on ? 1.6 : 0.6} vectorEffect="non-scaling-stroke" rx={2 / k} />
                    {it.vals.map((v, i) => { const bw = (2 * rr - 2 / k) / it.vals.length; const hmax = Math.max(...it.vals); const h = (v / hmax) * (2 * rr - 3 / k); return <rect key={i} x={-rr + 1 / k + i * bw} y={rr - 1 / k - h} width={Math.max(0.5 / k, bw - 0.8 / k)} height={h} fill={color(parts[i])} /> })}
                  </g>
                ) : (
                  <g>
                    {arcs(it.vals).map((a, i) => <path key={i} d={d3.arc().innerRadius(params.glyph === 'donut' ? rr * 0.55 : 0).outerRadius(rr)(a as never) ?? ''} fill={color(parts[i])} stroke="#fff" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
                    {on && <circle r={rr + 1.5 / k} fill="none" stroke="#121816" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />}
                  </g>
                )}
                {params.labels && !compact && rr * k > 11 && <text y={rr + 11 / k} fontSize={10 / k} textAnchor="middle" className="net-label" pointerEvents="none">{it.r.name}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={parts.map((p) => ({ key: p, color: color(p) }))} />
        <Readout items={[{ label: '지역', value: items.length }, { label: '구성', value: parts.length }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function GlyphControls({ params, setParams, table, mapping }: ControlsProps<GlyphParams>) {
  const data = useMemo(() => regionRows(table, mapping, NONE), [table, mapping])
  const resolved = useRegionResolved(params, data)
  return (
    <>
      <ControlGroup title="작은 차트">
        <Segmented label="종류" value={params.glyph} onChange={(glyph) => setParams({ glyph })} testId="ctl-glyph" options={[{ value: 'pie', label: '파이' }, { value: 'donut', label: '도넛' }, { value: 'bars', label: '막대' }]} />
        <Segmented label="크기" value={params.sizeMode} onChange={(sizeMode) => setParams({ sizeMode })} testId="ctl-glyph-size" options={[{ value: 'total', label: '규모에 비례' }, { value: 'fixed', label: '모두 같게' }]} />
        <Slider label="최대 크기 (반지름)" value={params.maxSize} min={12} max={60} onChange={(maxSize) => setParams({ maxSize })} format={(v) => `${v}px`} testId="ctl-glyph-max" />
        <Toggle label="지역 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
        <Hint>지역마다 작은 차트를 그 지역의 중심 위치에 올려 구성비를 한눈에 비교합니다. 크기는 ‘규모’ 열(있으면)이나 구성값의 합에 비례(넓이)합니다. 파이·도넛은 각도로, 막대는 길이로 비율을 나타내므로 비교가 정확해야 하면 막대를 고르세요. 차트가 겹치면 지도를 확대하세요.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const glyphMapModule: VizModule<GlyphParams> = {
  roles: [regionRole, { key: 'size', label: '규모 (선택, 크기)', type: 'number', prefer: '규모|인구|size' }, { key: 'parts', label: '구성 요소 (비율을 이룰 열)', type: 'number', required: true, multiple: { min: 2, max: 6 } }],
  datasets: ['kr-composition'],
  defaultParams: { ...geoDefaults, glyph: 'donut', maxSize: 30, sizeMode: 'total', showMap: true, labels: true, selected: '' },
  Chart: GlyphChart,
  Controls: GlyphControls,
  hint: '파이·도넛·막대로 바꿔 보세요 · 규모에 비례하는 크기 · 지역을 눌러 선택 · 확대해 겹친 차트를 확인',
}

